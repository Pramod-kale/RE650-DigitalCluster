/**
 * Navigation state for the full-screen map: pick a place → preview the routes
 * (alternatives, bike or car roads) → ride it. While riding, the route is
 * re-planned after a while off it, and the arrival time follows the rider's
 * own pace. Driven by the live ride track, so it only runs while a ride records.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { getTrack, subscribeTrack } from '@/engine/gps';
import { rememberPlace } from '@/storage/places';

import {
  etaSeconds,
  fetchRoutes,
  OFF_ROUTE_FOR_MS,
  OFF_ROUTE_M,
  REROUTE_GAP_MS,
  type Mode,
  type NavRoute,
  type Pace,
  type Place,
} from './navigate';
import { ARRIVED_M, bearingDeg, locate, type LatLon, type Progress } from './trackback';

type Active = { phase: 'active'; dest: Place; mode: Mode; route: NavRoute; rerouting: boolean; arrived: boolean };
export type NavState =
  | { phase: 'idle' }
  | { phase: 'preview'; dest: Place; mode: Mode; routes: NavRoute[] | null; pick: number; error: string | null }
  | Active;

const ALTERNATES = 2;
const IDLE: NavState = { phase: 'idle' };

/** Latest track point, and the direction of travel from the one before. */
function position(): { here: LatLon; heading: number | null } | null {
  const t = getTrack();
  if (!t.length) return null;
  const ll = (i: number): LatLon => ({ lat: t[i][1], lon: t[i][0] });
  const here = ll(t.length - 1);
  return { here, heading: t.length > 1 ? bearingDeg(ll(t.length - 2), here) : null };
}

function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return /network|abort|timeout|failed to fetch/i.test(msg) ? 'No connection to the route service' : msg;
}

export function useNavigation() {
  const [state, setStateRaw] = useState<NavState>(IDLE);
  const [view, setView] = useState<{ progress: Progress; leftS: number } | null>(null);
  // Mirrors `state` for the track callback; written with every change.
  const stateRef = useRef<NavState>(IDLE);
  const inflight = useRef<AbortController | null>(null);
  const pace = useRef<Pace>({ expectedS: 0, actualS: 0 });
  const checkpoint = useRef<{ route: NavRoute; leftM: number; t: number } | null>(null);
  const offSince = useRef<number | null>(null);
  const lastReroute = useRef(0);

  const setState = useCallback((next: NavState | ((s: NavState) => NavState)) => {
    stateRef.current = typeof next === 'function' ? next(stateRef.current) : next;
    setStateRaw(stateRef.current);
  }, []);

  const request = useCallback((dest: Place, mode: Mode, alternates: number) => {
    inflight.current?.abort();
    const pos = position();
    if (!pos) return Promise.reject(new Error('Waiting for GPS'));
    const ctl = new AbortController();
    inflight.current = ctl;
    return fetchRoutes(pos.here, dest, mode, { alternates, heading: pos.heading, signal: ctl.signal });
  }, []);

  // A new position (or a new route): progress, pace, arrival, reroute.
  const step = useCallback(() => {
    const s = stateRef.current;
    const pos = position();
    if (s.phase !== 'active' || !pos) return;
    const progress = locate(s.route.route, pos.here);
    if (!progress) return;
    const now = Date.now();

    // Pace: router-expected vs actual time for each stretch ridden on the route.
    const cp = checkpoint.current;
    if (progress.onTrack) {
      if (cp && cp.route === s.route) {
        const expected = ((cp.leftM - progress.along) * s.route.timeS) / Math.max(1, s.route.route.total);
        if (expected > 0) {
          // A long stop (fuel, food) is not riding pace: cap what one stretch adds.
          const actual = Math.min((now - cp.t) / 1000, expected * 4 + 60);
          pace.current = { expectedS: pace.current.expectedS + expected, actualS: pace.current.actualS + actual };
        }
      }
      checkpoint.current = { route: s.route, leftM: progress.along, t: now };
    } else {
      checkpoint.current = null;
    }
    setView({ progress, leftS: etaSeconds(s.route, progress.along, pace.current) });
    if (s.arrived) return;
    if (progress.onTrack && progress.along <= ARRIVED_M) {
      setState({ ...s, arrived: true });
      return;
    }

    // Reroute after riding off the route for a while.
    if (progress.offTrackM <= OFF_ROUTE_M) {
      offSince.current = null;
      return;
    }
    offSince.current ??= now;
    if (s.rerouting || now - offSince.current < OFF_ROUTE_FOR_MS || now - lastReroute.current < REROUTE_GAP_MS) return;
    lastReroute.current = now;
    setState({ ...s, rerouting: true });
    request(s.dest, s.mode, 0).then(
      ([route]) => {
        if (stateRef.current.phase !== 'active' || stateRef.current.dest !== s.dest) return;
        offSince.current = null;
        checkpoint.current = null;
        setState({ ...stateRef.current, route, rerouting: false });
        const p = position();
        const prog = p && locate(route.route, p.here);
        if (prog) setView({ progress: prog, leftS: etaSeconds(route, prog.along, pace.current) });
      },
      (e) => {
        if (e?.name !== 'AbortError') console.warn('[nav] reroute failed', e);
        setState((cur) => (cur.phase === 'active' && cur.dest === s.dest ? { ...cur, rerouting: false } : cur));
      },
    );
  }, [request, setState]);

  useEffect(() => subscribeTrack(step), [step]);
  useEffect(() => () => inflight.current?.abort(), []);

  const preview = useCallback(
    (dest: Place, mode: Mode) => {
      setState({ phase: 'preview', dest, mode, routes: null, pick: 0, error: null });
      const same = (s: NavState) => s.phase === 'preview' && s.dest === dest && s.mode === mode;
      request(dest, mode, ALTERNATES).then(
        (routes) => setState((s) => (same(s) ? { ...s, routes } : s)),
        (e) => {
          if (e?.name === 'AbortError') return;
          setState((s) => (same(s) ? { ...s, error: errorText(e) } : s));
        },
      );
    },
    [request, setState],
  );

  const choose = useCallback(
    (dest: Place) => {
      const s = stateRef.current;
      preview(dest, s.phase === 'idle' ? 'bike' : s.mode);
    },
    [preview],
  );

  const setMode = useCallback(
    (mode: Mode) => {
      const s = stateRef.current;
      if (s.phase === 'preview') preview(s.dest, mode);
    },
    [preview],
  );

  const pick = useCallback((i: number) => setState((s) => (s.phase === 'preview' ? { ...s, pick: i } : s)), [setState]);

  const start = useCallback(() => {
    const s = stateRef.current;
    if (s.phase !== 'preview' || !s.routes) return;
    rememberPlace(s.dest);
    pace.current = { expectedS: 0, actualS: 0 };
    checkpoint.current = null;
    offSince.current = null;
    lastReroute.current = Date.now();
    setView(null);
    setState({ phase: 'active', dest: s.dest, mode: s.mode, route: s.routes[s.pick], rerouting: false, arrived: false });
    step();
  }, [setState, step]);

  const end = useCallback(() => {
    inflight.current?.abort();
    inflight.current = null;
    setView(null);
    setState(IDLE);
  }, [setState]);

  const active = state.phase === 'active';
  return {
    state,
    progress: active ? (view?.progress ?? null) : null,
    leftS: active ? (view?.leftS ?? null) : null,
    choose,
    setMode,
    pick,
    start,
    end,
  };
}
