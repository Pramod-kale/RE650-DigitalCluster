/**
 * Navigate to a searched place. Free OpenStreetMap services, no API key:
 *  - Photon (photon.komoot.io): place search, built for search-as-you-type,
 *    biased towards the rider's position.
 *  - Valhalla (valhalla1.openstreetmap.de): routes with real two-wheeler
 *    costing. "Car roads" uses the car profile, which sticks to wider roads.
 * Both are public fair-use servers: keep requests few (debounced search,
 * throttled reroutes).
 *
 * Progress along a route reuses the trackback maths: the route is stored
 * destination-first, so `along` from locate() is the distance left to ride.
 */
import type { Position } from 'geojson';

import { distM, type LatLon, type Route } from './trackback';

const PHOTON_URL = 'https://photon.komoot.io/api/';
const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';
const TIMEOUT_MS = 15_000;
// Search results with the same name closer than this are one place.
const SAME_PLACE_M = 1_000;

// Off the route by more than this for OFF_ROUTE_FOR_MS asks for a new route.
export const OFF_ROUTE_M = 50;
export const OFF_ROUTE_FOR_MS = 8_000;
// At most one reroute per this long (the routing server is shared).
export const REROUTE_GAP_MS = 15_000;
// The rider's pace replaces the router's estimate once this much expected
// riding time has been measured; until then the router's times are used.
const PACE_MIN_EXPECTED_S = 120;
const PACE_RANGE = [0.5, 2.5] as const;

export type Mode = 'bike' | 'car';
export const MODES: { mode: Mode; label: string }[] = [
  { mode: 'bike', label: 'Bike' },
  { mode: 'car', label: 'Car roads' },
];
// Valhalla's default motorcycle profile routes exactly like the car one;
// lowering its highway preference gives the shorter, smaller-road routes a
// two-wheeler takes, while keeping motorcycle speeds for the time estimate.
const COSTING: Record<Mode, { costing: string; options: Record<string, number> }> = {
  bike: { costing: 'motorcycle', options: { use_highways: 0.3 } },
  car: { costing: 'auto', options: {} },
};

export type Place = { name: string; detail: string; lat: number; lon: number };

export type NavRoute = {
  line: Position[]; // [lon, lat], start → destination
  route: Route; // destination-first, for locate()
  km: number;
  timeS: number; // the router's estimate
};

async function fetchJson(url: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const abort = () => ctl.abort();
  signal?.addEventListener('abort', abort);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = body && typeof body === 'object' && 'error' in body ? String(body.error) : `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return body;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

type PhotonProps = {
  name?: string;
  housenumber?: string;
  street?: string;
  district?: string;
  locality?: string;
  city?: string;
  county?: string;
  state?: string;
};
type PhotonFeature = { properties?: PhotonProps; geometry?: { coordinates?: number[] } };

/** A Photon feature as a place; null when it has no usable name or position. */
export function toPlace(f: PhotonFeature): Place | null {
  const p = f.properties ?? {};
  const [lon, lat] = f.geometry?.coordinates ?? [];
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const name = p.name ?? street;
  if (!name) return null;
  const parts = [p.name ? street : '', p.district ?? p.locality, p.city ?? p.county, p.state];
  const detail = parts.filter((s, i): s is string => !!s && parts.indexOf(s) === i).join(', ');
  return { name, detail, lat, lon };
}

/** Places matching `q`, nearest-first around `near`. */
export async function searchPlaces(q: string, near: LatLon | null, signal?: AbortSignal): Promise<Place[]> {
  const params = new URLSearchParams({ q, limit: '6', lang: 'en' });
  if (near) {
    params.set('lat', near.lat.toFixed(5));
    params.set('lon', near.lon.toFixed(5));
  }
  const body = (await fetchJson(`${PHOTON_URL}?${params}`, {}, signal)) as { features?: PhotonFeature[] };
  const out: Place[] = [];
  for (const p of (body.features ?? []).map(toPlace)) {
    // The same place often comes back as several OSM objects (node, way, area).
    if (p && !out.some((q) => q.name === p.name && distM(p, q) < SAME_PLACE_M)) out.push(p);
  }
  return out;
}

/** Decode a Valhalla shape (Google polyline, 6 decimal places) to [lon, lat]. */
export function decodePolyline6(s: string): Position[] {
  const out: Position[] = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let result = 0;
    let shift = 1;
    let b: number;
    do {
      b = s.charCodeAt(i++) - 63;
      result += (b & 0x1f) * shift; // multiply, not <<: large values overflow 32 bits
      shift *= 32;
    } while (b >= 0x20);
    return result % 2 ? -(result + 1) / 2 : result / 2;
  };
  while (i < s.length) {
    lat += next();
    lon += next();
    out.push([lon / 1e6, lat / 1e6]);
  }
  return out;
}

/** A start → destination line as a destination-first Route for locate(). */
export function toNavRoute(line: Position[], km: number, timeS: number): NavRoute {
  const pts: LatLon[] = [];
  const along: number[] = [];
  let total = 0;
  for (let i = line.length - 1; i >= 0; i--) {
    const p = { lat: line[i][1], lon: line[i][0] };
    const prev = pts[pts.length - 1];
    if (prev && prev.lat === p.lat && prev.lon === p.lon) continue;
    if (prev) total += distM(prev, p);
    pts.push(p);
    along.push(total);
  }
  return { line, route: { pts, along, total }, km, timeS };
}

type ValhallaTrip = { legs?: { shape?: string }[]; summary?: { length?: number; time?: number } };

function tripRoute(trip: ValhallaTrip | undefined): NavRoute | null {
  const shape = trip?.legs?.[0]?.shape;
  if (!shape) return null;
  const line = decodePolyline6(shape);
  if (line.length < 2) return null;
  return toNavRoute(line, trip?.summary?.length ?? 0, trip?.summary?.time ?? 0);
}

/**
 * Routes from `from` to `to`, best first (up to 1 + `alternates`). `heading`
 * (degrees, direction of travel) keeps the route from starting with a U-turn.
 */
export async function fetchRoutes(
  from: LatLon,
  to: LatLon,
  mode: Mode,
  { alternates = 0, heading = null, signal }: { alternates?: number; heading?: number | null; signal?: AbortSignal } = {},
): Promise<NavRoute[]> {
  const start: Record<string, number> = { lat: from.lat, lon: from.lon };
  if (heading != null) {
    start.heading = Math.round(heading);
    start.heading_tolerance = 60;
  }
  const body = (await fetchJson(
    VALHALLA_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locations: [start, { lat: to.lat, lon: to.lon }],
        costing: COSTING[mode].costing,
        costing_options: { [COSTING[mode].costing]: COSTING[mode].options },
        alternates,
        directions_type: 'none',
        units: 'kilometers',
      }),
    },
    signal,
  )) as { trip?: ValhallaTrip; alternates?: { trip?: ValhallaTrip }[] };
  const routes = [body.trip, ...(body.alternates ?? []).map((a) => a.trip)].map(tripRoute);
  const out = routes.filter((r): r is NavRoute => r != null);
  if (!out.length) throw new Error('No route found');
  return out;
}

/** Expected vs actual riding seconds so far, for the rider's own pace. */
export type Pace = { expectedS: number; actualS: number };

/**
 * Seconds left: the router's estimate for the distance left, scaled by how
 * the rider has actually been doing against it (traffic, stops, riding style).
 */
export function etaSeconds(r: NavRoute, leftM: number, pace: Pace): number {
  const routerS = r.route.total > 0 ? (r.timeS * leftM) / r.route.total : 0;
  if (pace.expectedS < PACE_MIN_EXPECTED_S) return routerS;
  const k = Math.min(PACE_RANGE[1], Math.max(PACE_RANGE[0], pace.actualS / pace.expectedS));
  return routerS * k;
}

/** Bounding box [west, south, east, north] of some lines plus extra points. */
export function boundsOf(lines: Position[][], extra: Position[] = []): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of [...lines.flat(), ...extra]) {
    w = Math.min(w, p[0]);
    e = Math.max(e, p[0]);
    s = Math.min(s, p[1]);
    n = Math.max(n, p[1]);
  }
  return [w, s, e, n];
}

export function fmtDist(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km`;
  return `${Math.round(m / 10) * 10} m`;
}

export function fmtDuration(s: number): string {
  const min = Math.max(1, Math.round(s / 60));
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

/** Clock time `s` seconds from `now`, as HH:MM. */
export function fmtClock(s: number, now = Date.now()): string {
  const d = new Date(now + s * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
