/**
 * In-memory live state: replaces the _state/_session/_tank/_odometer globals and
 * the /api/* endpoints of backend/main.py. UI subscribes via useSyncExternalStore.
 */
import { calcFuelLh, estimateGear } from '@/obd/decode';

import { instantKmPerL, kmPerL } from './units';
import type { PidName } from '@/obd/constants';

export const STALE_AFTER_MS = 2000; // no new data in 2s → disconnected

export type LiveState = {
  connected: boolean;
  lastUpdate: number | null; // epoch ms
  rpm: number;
  speed: number;
  tps: number;
  map: number;
  iat: number;
  eot: number;
  load: number;
  voltage: number;
  fuelLh: number;
  gear: number | null;
};

type Session = {
  start: number;
  vMax: number;
  rpmMax: number;
  eotMax: number;
  fuelTotalL: number;
  kmTotal: number;
  lastT: number;
};

export type Tank = { sinceFillL: number; sinceFillKm: number; lastFillT: number | null };
export type Odometer = { kmTotal: number; fuelTotalL: number; startedAt: number | null };

/** What gets written to state.json. */
export type PersistedState = {
  km_total: number;
  fuel_total_l: number;
  started_at: number | null;
  tank_since_fill_l: number;
  tank_since_fill_km: number;
  tank_last_fill_t: number | null;
  saved_at: number;
};

export type Snapshot = {
  data: LiveState & { staleSeconds: number | null; kmPerL: number | null };
  session: {
    elapsedMin: number;
    vMax: number;
    rpmMax: number;
    eotMax: number;
    fuelTotalL: number;
    kmTotal: number;
    kmPerL: number | null;
  };
  tank: Tank & { kmPerL: number | null };
  odometer: Odometer & { kmPerL: number | null; daysActive: number };
  link: string; // human status from the poller ("connecting…", "retry in 4s", …)
};

const now = () => Date.now();

const state: LiveState = {
  connected: false,
  lastUpdate: null,
  rpm: 0,
  speed: 0,
  tps: 0,
  map: 0,
  iat: 25,
  eot: 0,
  load: 0,
  voltage: 0,
  fuelLh: 0,
  gear: null,
};

const session: Session = {
  start: now(),
  vMax: 0,
  rpmMax: 0,
  eotMax: 0,
  fuelTotalL: 0,
  kmTotal: 0,
  lastT: now(),
};

// Accumulators since the user marked "tank full"; persisted.
const tank: Tank = { sinceFillL: 0, sinceFillKm: 0, lastFillT: null };
// Lifetime odometer since the app started recording; persisted.
const odometer: Odometer = { kmTotal: 0, fuelTotalL: 0, startedAt: null };

let link = 'starting';

function round(v: number, digits: number) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function isFresh(lastUpdate: number | null, t = now()): boolean {
  return lastUpdate != null && t - lastUpdate < STALE_AFTER_MS;
}

// ---------------------------------------------------------------------------
// Mutations (called by the poller)
// ---------------------------------------------------------------------------

/** Store one decoded PID, then recompute derived values + accumulators. */
export function applyPid(name: PidName, value: number, ve: number, correction: number, t = now()) {
  resumeIfStale(t);
  state[name] = value;
  state.lastUpdate = t;
  state.connected = true;
  recompute(ve, correction, t);
}

/** Store a whole sample at once (mock mode). */
export function applySample(
  v: Pick<LiveState, PidName | 'voltage'>,
  ve: number,
  correction: number,
  t = now(),
) {
  resumeIfStale(t);
  Object.assign(state, v);
  state.lastUpdate = t;
  state.connected = true;
  recompute(ve, correction, t);
}

/**
 * Don't integrate across a gap (bike off, dongle lost, app backgrounded): the
 * first sample after it would otherwise add gap × last speed to the km totals.
 */
function resumeIfStale(t: number) {
  if (!isFresh(state.lastUpdate, t)) session.lastT = t;
}

function recompute(ve: number, correction: number, t: number) {
  state.fuelLh = calcFuelLh(state.map, state.rpm, state.iat, ve, correction);
  state.gear = estimateGear(state.rpm, state.speed);
  const dtH = Math.max(0, t - session.lastT) / 3_600_000;
  const dL = state.fuelLh * dtH;
  const dKm = state.speed * dtH;
  session.vMax = Math.max(session.vMax, state.speed);
  session.rpmMax = Math.max(session.rpmMax, state.rpm);
  session.eotMax = Math.max(session.eotMax, state.eot);
  session.fuelTotalL += dL;
  session.kmTotal += dKm;
  tank.sinceFillL += dL;
  tank.sinceFillKm += dKm;
  odometer.fuelTotalL += dL;
  odometer.kmTotal += dKm;
  session.lastT = t;
  notify();
}

export function setVoltage(v: number, t = now()) {
  state.voltage = v;
  state.lastUpdate = t;
  notify();
}

export function setConnected(c: boolean) {
  state.connected = c;
  notify();
}

export function setLink(text: string) {
  link = text;
  notify();
}

export function resetSession() {
  const t = now();
  Object.assign(session, {
    start: t,
    lastT: t,
    vMax: 0,
    rpmMax: 0,
    eotMax: 0,
    fuelTotalL: 0,
    kmTotal: 0,
  });
  notify(true);
}

/** Unrounded since-refuel accumulators (what a new fuel entry records). */
export function getTankRaw(): Readonly<Tank> {
  return { ...tank };
}

/** Reset since-refuel accumulators at time t. Caller must persist immediately. */
export function markTankFull(t = now()) {
  tank.sinceFillL = 0;
  tank.sinceFillKm = 0;
  tank.lastFillT = t;
  notify(true);
}

/** Give back km/litres of a deleted latest refuel so the running tank stays whole. */
export function restoreTank(addKm: number, addL: number, lastFillT: number | null) {
  tank.sinceFillKm += addKm;
  tank.sinceFillL += addL;
  tank.lastFillT = lastFillT;
  notify(true);
}

// ---------------------------------------------------------------------------
// Persistence glue
// ---------------------------------------------------------------------------
export function toPersisted(): PersistedState {
  return {
    km_total: odometer.kmTotal,
    fuel_total_l: odometer.fuelTotalL,
    started_at: odometer.startedAt,
    tank_since_fill_l: tank.sinceFillL,
    tank_since_fill_km: tank.sinceFillKm,
    tank_last_fill_t: tank.lastFillT,
    saved_at: now(),
  };
}

export function restorePersisted(p: PersistedState | null) {
  if (!p) {
    odometer.startedAt = odometer.startedAt ?? now();
  } else {
    odometer.kmTotal = p.km_total;
    odometer.fuelTotalL = p.fuel_total_l;
    odometer.startedAt = p.started_at ?? now();
    tank.sinceFillL = p.tank_since_fill_l;
    tank.sinceFillKm = p.tank_since_fill_km;
    tank.lastFillT = p.tank_last_fill_t;
  }
  notify(true);
}

/** Current values for one CSV row, or null when data is stale. */
export function csvRow(t = now()): string[] | null {
  if (!isFresh(state.lastUpdate, t)) return null;
  const d = new Date(t);
  const ts = [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
  return [
    ts,
    state.rpm.toFixed(0),
    state.speed.toFixed(0),
    state.tps.toFixed(2),
    state.map.toFixed(1),
    state.iat.toFixed(1),
    state.eot.toFixed(1),
    state.load.toFixed(2),
    state.voltage.toFixed(2),
    state.fuelLh.toFixed(3),
    state.gear == null ? '' : String(state.gear),
  ];
}

export function getLive(): Readonly<LiveState> {
  return state;
}

export function getSessionTotals() {
  return { vMax: session.vMax, kmTotal: session.kmTotal, fuelTotalL: session.fuelTotalL };
}

// ---------------------------------------------------------------------------
// Snapshot + subscription (throttled to ~5 Hz for the UI)
// ---------------------------------------------------------------------------
function buildSnapshot(): Snapshot {
  const t = now();
  const connected = state.connected && isFresh(state.lastUpdate, t);
  const sp = state.speed;
  return {
    data: {
      ...state,
      connected,
      staleSeconds: state.lastUpdate ? round((t - state.lastUpdate) / 1000, 2) : null,
      kmPerL: instantKmPerL(sp, state.fuelLh),
    },
    session: {
      elapsedMin: round((t - session.start) / 60000, 2),
      vMax: session.vMax,
      rpmMax: session.rpmMax,
      eotMax: session.eotMax,
      fuelTotalL: round(session.fuelTotalL, 3),
      kmTotal: round(session.kmTotal, 2),
      kmPerL: kmPerL(session.kmTotal, session.fuelTotalL),
    },
    tank: {
      sinceFillL: round(tank.sinceFillL, 3),
      sinceFillKm: round(tank.sinceFillKm, 2),
      lastFillT: tank.lastFillT,
      kmPerL: kmPerL(tank.sinceFillKm, tank.sinceFillL),
    },
    odometer: {
      kmTotal: round(odometer.kmTotal, 2),
      fuelTotalL: round(odometer.fuelTotalL, 3),
      startedAt: odometer.startedAt,
      kmPerL: kmPerL(odometer.kmTotal, odometer.fuelTotalL),
      daysActive: odometer.startedAt ? round((t - odometer.startedAt) / 86_400_000, 1) : 0,
    },
    link,
  };
}

const listeners = new Set<() => void>();
let snapshot: Snapshot = buildSnapshot();
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let lastEmit = 0;
const MIN_EMIT_MS = 200;

function emit() {
  pendingTimer = null;
  lastEmit = now();
  snapshot = buildSnapshot();
  listeners.forEach((l) => l());
}

function notify(immediate = false) {
  if (immediate) {
    if (pendingTimer) clearTimeout(pendingTimer);
    emit();
    return;
  }
  if (pendingTimer) return;
  pendingTimer = setTimeout(emit, Math.max(0, MIN_EMIT_MS - (now() - lastEmit)));
}

// Staleness is time-based, so refresh the snapshot even when no data arrives.
setInterval(() => notify(), 1000);

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): Snapshot {
  return snapshot;
}
