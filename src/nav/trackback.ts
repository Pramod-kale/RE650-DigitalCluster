/**
 * Trackback: lead the rider back to where a ride started along the recorded
 * track (no routing service, works offline). Pure maths on the ride's fixes.
 *
 * Position is snapped to the track, and "along" is the distance from the
 * start to that point along the track, i.e. what is left to ride. Where the
 * track passes the same place twice (a loop, or out and back on one road),
 * the snap picks the pass closest to the start, so loops are skipped.
 */
import type { Position } from 'geojson';

import type { Sample } from '@/storage/rideTrack';

const M_PER_DEG = 111_320;
// Within this of the track counts as on it (GPS error + road width).
export const ON_TRACK_M = 40;
// The arrow points at the track this far ahead, which smooths out bends.
const LOOKAHEAD_M = 60;
// Closer than this to the start (and on track) counts as arrived.
export const ARRIVED_M = 30;

export type LatLon = { lat: number; lon: number };

export type Route = {
  pts: LatLon[];
  along: number[]; // metres from the start to each point
  total: number;
};

export type Progress = {
  along: number; // metres left along the track from the snapped point
  offTrackM: number; // distance from the rider to the snapped point
  onTrack: boolean;
  seg: number; // segment index of the snapped point
  snapped: LatLon;
};

/** Metres between two points (equirectangular; fine at ride scale). */
export function distM(a: LatLon, b: LatLon): number {
  const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const dx = (b.lon - a.lon) * k * M_PER_DEG;
  const dy = (b.lat - a.lat) * M_PER_DEG;
  return Math.hypot(dx, dy);
}

/** Initial compass bearing from a to b, 0–360°. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const r = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
  const x =
    Math.cos(a.lat * r) * Math.sin(b.lat * r) -
    Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function compass(deg: number): string {
  return COMPASS[Math.round(deg / 45) % 8];
}

export function buildRoute(samples: Sample[]): Route {
  const pts: LatLon[] = [];
  const along: number[] = [];
  let total = 0;
  for (const s of samples) {
    if (s.lat == null || s.lon == null) continue;
    const p = { lat: s.lat, lon: s.lon };
    const prev = pts[pts.length - 1];
    if (prev && prev.lat === p.lat && prev.lon === p.lon) continue;
    if (prev) total += distM(prev, p);
    pts.push(p);
    along.push(total);
  }
  return { pts, along, total };
}

export function locate(route: Route, pos: LatLon, accuracyM = 0): Progress | null {
  const { pts, along } = route;
  if (pts.length === 0) return null;
  if (pts.length === 1) {
    const d = distM(pos, pts[0]);
    return { along: 0, offTrackM: d, onTrack: d <= ON_TRACK_M, seg: 0, snapped: pts[0] };
  }
  // Local metric frame centred on the rider.
  const k = Math.cos((pos.lat * Math.PI) / 180) * M_PER_DEG;
  const xy = (p: LatLon) => [(p.lon - pos.lon) * k, (p.lat - pos.lat) * M_PER_DEG];
  const tol = Math.max(ON_TRACK_M, accuracyM);

  let near: Progress | null = null; // on track, smallest along
  let best: Progress | null = null; // nearest overall
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = xy(pts[i]);
    const [bx, by] = xy(pts[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d = Math.hypot(px, py);
    const p: Progress = {
      along: along[i] + t * (along[i + 1] - along[i]),
      offTrackM: d,
      onTrack: d <= tol,
      seg: i,
      snapped: {
        lat: pts[i].lat + t * (pts[i + 1].lat - pts[i].lat),
        lon: pts[i].lon + t * (pts[i + 1].lon - pts[i].lon),
      },
    };
    if (!best || d < best.offTrackM) best = p;
    if (d <= tol && (!near || p.along < near.along)) near = p;
  }
  return near ?? best;
}

/** The point `m` metres from the start along the route. */
export function pointAt(route: Route, m: number): LatLon {
  const { pts, along } = route;
  if (m <= 0 || pts.length === 1) return pts[0];
  let i = 1;
  while (i < pts.length - 1 && along[i] < m) i++;
  const seg = along[i] - along[i - 1];
  const t = seg > 0 ? Math.min(1, (m - along[i - 1]) / seg) : 1;
  return {
    lat: pts[i - 1].lat + t * (pts[i].lat - pts[i - 1].lat),
    lon: pts[i - 1].lon + t * (pts[i].lon - pts[i - 1].lon),
  };
}

/** Compass bearing the rider should head: at the track ahead, or back onto it. */
export function targetBearing(route: Route, pos: LatLon, p: Progress): number {
  const target = p.onTrack ? pointAt(route, p.along - LOOKAHEAD_M) : p.snapped;
  return bearingDeg(pos, target);
}

/** Track split at the snapped point: still to ride (start → here) and already retraced. */
export function splitLines(route: Route, p: Progress): { ahead: Position[]; done: Position[] } {
  const ll = (q: LatLon): Position => [q.lon, q.lat];
  const ahead = route.pts.slice(0, p.seg + 1).map(ll);
  ahead.push(ll(p.snapped));
  const done = [ll(p.snapped), ...route.pts.slice(p.seg + 1).map(ll)];
  return { ahead, done };
}
