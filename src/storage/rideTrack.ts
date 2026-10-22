/**
 * Pure ride analysis for the ride detail screen (no I/O): parses a ride CSV
 * into samples, builds the GeoJSON track coloured by a metric, and computes
 * ride stats. Rides recorded before GPS logging simply have no track.
 */
import type { FeatureCollection, LineString, Point, Position } from 'geojson';

import { cleanSpeed } from '@/obd/decode';

import { MAX_DT_S } from './rideSummary';

// Below this the bike counts as stopped (OBD speed reads 0–2 when rolling to a halt).
const STOPPED_KMH = 3;
// Fixes worse than this are dropped; they zig-zag across the map.
const MAX_ACC_M = 50;
// Points further apart in time are not joined (signal lost, tunnel, bike off).
const MAX_GAP_S = 30;
// A stop at least this long gets a pin.
const STOP_PIN_S = 60;
// Economy is averaged over ±this many seconds; instantaneous km/L is too noisy.
const ECONOMY_WINDOW_S = 5;

export type Sample = {
  s: number; // seconds since the first row (wall clock, includes gaps)
  dt: number; // seconds since the previous row; 0 across gaps longer than MAX_DT_S
  rpm: number;
  speed: number;
  tps: number;
  eot: number;
  voltage: number;
  fuelLh: number;
  lat: number | null;
  lon: number | null;
};

function num(f: string[], i: number): number | null {
  if (i < 0 || !f[i]) return null; // Number('') is 0, not "missing"
  const v = Number(f[i]);
  return Number.isFinite(v) ? v : null;
}

export function parseRideCsv(text: string): Sample[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = (lines.shift() ?? '').split(',');
  const col = (n: string) => header.indexOf(n);
  const i = {
    ts: col('timestamp'),
    rpm: col('rpm'),
    speed: col('speed'),
    tps: col('tps'),
    eot: col('eot'),
    voltage: col('voltage'),
    fuel: col('fuel_lh'),
    lat: col('lat'),
    lon: col('lon'),
    acc: col('gps_acc'),
  };

  const out: Sample[] = [];
  let prevClock: number | null = null;
  let s = 0;
  for (const line of lines) {
    const f = line.split(',');
    const ts = f[i.ts]?.split(':').map(Number);
    if (!ts || ts.length !== 3 || ts.some((n) => !Number.isFinite(n))) continue;
    const clock = ts[0] * 3600 + ts[1] * 60 + ts[2];
    let dt = 0;
    if (prevClock != null) {
      let d = clock - prevClock;
      if (d < 0) d += 86400; // crossed midnight
      s += d;
      dt = d <= MAX_DT_S ? d : 0;
    }
    prevClock = clock;

    const lat = num(f, i.lat);
    const lon = num(f, i.lon);
    const acc = num(f, i.acc);
    const fix = lat != null && lon != null && (acc == null || acc <= MAX_ACC_M);
    out.push({
      s,
      dt,
      rpm: num(f, i.rpm) ?? 0,
      speed: cleanSpeed(num(f, i.speed) ?? 0) ?? 0,
      tps: num(f, i.tps) ?? 0,
      eot: num(f, i.eot) ?? 0,
      voltage: num(f, i.voltage) ?? 0,
      fuelLh: num(f, i.fuel) ?? 0,
      lat: fix ? lat : null,
      lon: fix ? lon : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Metrics and colour bands
// ---------------------------------------------------------------------------
export type Metric = 'speed' | 'economy' | 'rpm' | 'throttle';

export type Band = { upTo: number; color: string; label: string };

export const STOPPED_COLOR = '#71717a';

// One cool → warm scale for every metric (the design's Palette board); the
// orange / red steps match the dashboard's zones. Economy runs the other way.
const SCALE = ['#93c5fd', '#22d3ee', '#6ee7b7', '#e9d28a', '#f0a35e', '#f0716a'] as const;
const [BLUE, CYAN, MINT, SAND, ORANGE, RED] = SCALE;

export const METRICS: Record<Metric, { label: string; bands: Band[] }> = {
  speed: {
    label: 'Speed',
    bands: [
      { upTo: 20, color: BLUE, label: '< 20 km/h' },
      { upTo: 40, color: CYAN, label: '20–40' },
      { upTo: 60, color: MINT, label: '40–60' },
      { upTo: 80, color: SAND, label: '60–80' },
      { upTo: 100, color: ORANGE, label: '80–100' },
      { upTo: Infinity, color: RED, label: '100+ km/h' },
    ],
  },
  economy: {
    label: 'Economy',
    bands: [
      { upTo: 15, color: RED, label: '< 15 km/L' },
      { upTo: 20, color: ORANGE, label: '15–20' },
      { upTo: 25, color: SAND, label: '20–25' },
      { upTo: 30, color: MINT, label: '25–30' },
      { upTo: Infinity, color: CYAN, label: '30+ / coasting' },
    ],
  },
  rpm: {
    label: 'RPM',
    bands: [
      { upTo: 2500, color: BLUE, label: '< 2500' },
      { upTo: 4000, color: MINT, label: '2500–4000' },
      { upTo: 5500, color: SAND, label: '4000–5500' },
      { upTo: 7000, color: ORANGE, label: '5500–7000' },
      { upTo: Infinity, color: RED, label: '7000+' },
    ],
  },
  throttle: {
    label: 'Throttle',
    bands: [
      { upTo: 10, color: BLUE, label: '< 10 %' },
      { upTo: 30, color: MINT, label: '10–30' },
      { upTo: 60, color: SAND, label: '30–60' },
      { upTo: 85, color: ORANGE, label: '60–85' },
      { upTo: Infinity, color: RED, label: '85+ %' },
    ],
  },
};

/** km/L averaged over ±ECONOMY_WINDOW_S; Infinity while coasting (no fuel). */
function economyValues(samples: Sample[]): number[] {
  const n = samples.length;
  const km = new Float64Array(n + 1);
  const l = new Float64Array(n + 1);
  samples.forEach((p, i) => {
    km[i + 1] = km[i] + (p.speed * p.dt) / 3600;
    l[i + 1] = l[i] + (p.fuelLh * p.dt) / 3600;
  });
  const out: number[] = [];
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    while (samples[i].s - samples[lo].s > ECONOMY_WINDOW_S) lo++;
    while (hi + 1 < n && samples[hi + 1].s - samples[i].s <= ECONOMY_WINDOW_S) hi++;
    const dKm = km[hi + 1] - km[lo];
    const dL = l[hi + 1] - l[lo];
    out.push(dL > 1e-6 ? dKm / dL : Infinity);
  }
  return out;
}

export function metricValues(samples: Sample[], metric: Metric): number[] {
  switch (metric) {
    case 'speed':
      return samples.map((p) => p.speed);
    case 'rpm':
      return samples.map((p) => p.rpm);
    case 'throttle':
      return samples.map((p) => p.tps);
    case 'economy':
      return economyValues(samples);
  }
}

/** Band index for a value, or -1 when stopped. */
export function bandOf(metric: Metric, value: number, speed: number): number {
  if (speed < STOPPED_KMH) return -1;
  const bands = METRICS[metric].bands;
  const i = bands.findIndex((b) => value < b.upTo);
  return i < 0 ? bands.length - 1 : i;
}

// ---------------------------------------------------------------------------
// GeoJSON
// ---------------------------------------------------------------------------
export type TrackLines = FeatureCollection<LineString, { band: number }>;

/**
 * The track as LineStrings, one per run of consecutive points in the same
 * band, so a long ride is a few hundred features rather than one per sample.
 */
export function buildTrack(samples: Sample[], metric: Metric): TrackLines {
  const values = metricValues(samples, metric);
  const features: TrackLines['features'] = [];
  let run: { band: number; coords: Position[] } | null = null;
  let prev: { pt: Position; s: number } | null = null;

  const flush = () => {
    if (run && run.coords.length >= 2) {
      features.push({
        type: 'Feature',
        properties: { band: run.band },
        geometry: { type: 'LineString', coordinates: run.coords },
      });
    }
    run = null;
  };

  samples.forEach((p, i) => {
    if (p.lat == null || p.lon == null) return;
    const pt: Position = [p.lon, p.lat];
    if (prev && p.s - prev.s > MAX_GAP_S) {
      flush();
      prev = null;
    }
    if (!prev) {
      prev = { pt, s: p.s };
      return;
    }
    // The poller writes several rows per GPS fix; only new positions add a vertex.
    if (prev.pt[0] === pt[0] && prev.pt[1] === pt[1]) {
      prev.s = p.s;
      return;
    }
    const band = bandOf(metric, values[i], p.speed);
    if (!run || run.band !== band) {
      flush();
      run = { band, coords: [prev.pt] };
    }
    run.coords.push(pt);
    prev = { pt, s: p.s };
  });
  flush();
  return { type: 'FeatureCollection', features };
}

export type PinKind = 'start' | 'end' | 'vmax' | 'stop';
export type TrackPins = FeatureCollection<Point, { kind: PinKind }>;

export function buildPins(samples: Sample[]): TrackPins {
  const fixes = samples.filter((p) => p.lat != null && p.lon != null);
  const features: TrackPins['features'] = [];
  const pin = (p: Sample, kind: PinKind) =>
    features.push({
      type: 'Feature',
      properties: { kind },
      geometry: { type: 'Point', coordinates: [p.lon!, p.lat!] },
    });
  if (fixes.length === 0) return { type: 'FeatureCollection', features };

  // Stops in the middle of the ride (not warming up at the start or parking at the end).
  let stopStart: number | null = null;
  fixes.forEach((p, i) => {
    if (p.speed < STOPPED_KMH) {
      stopStart ??= i;
      return;
    }
    if (stopStart != null && stopStart > 0 && p.s - fixes[stopStart].s >= STOP_PIN_S) {
      pin(fixes[stopStart], 'stop');
    }
    stopStart = null;
  });

  const top = fixes.reduce((a, b) => (b.speed > a.speed ? b : a));
  if (top.speed >= STOPPED_KMH) pin(top, 'vmax');
  pin(fixes[0], 'start');
  pin(fixes[fixes.length - 1], 'end');
  return { type: 'FeatureCollection', features };
}

/** [west, south, east, north] of all fixes, or null when the ride has none. */
export function trackBounds(samples: Sample[]): [number, number, number, number] | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of samples) {
    if (p.lat == null || p.lon == null) continue;
    w = Math.min(w, p.lon);
    e = Math.max(e, p.lon);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
export type RideStats = {
  km: number;
  movingS: number;
  stoppedS: number;
  avgMovingKmh: number | null;
  vMax: number;
  rpmMax: number;
  fuelL: number;
  idleFuelL: number;
  eotMax: number | null;
  voltMin: number | null;
  gpsFixes: number;
};

export function rideStats(samples: Sample[]): RideStats {
  let km = 0;
  let movingS = 0;
  let stoppedS = 0;
  let movingKm = 0;
  let vMax = 0;
  let rpmMax = 0;
  let fuelL = 0;
  let idleFuelL = 0;
  let eotMax: number | null = null;
  let voltMin: number | null = null;
  let gpsFixes = 0;

  for (const p of samples) {
    const dKm = (p.speed * p.dt) / 3600;
    const dL = (p.fuelLh * p.dt) / 3600;
    km += dKm;
    fuelL += dL;
    if (p.speed < STOPPED_KMH) {
      stoppedS += p.dt;
      idleFuelL += dL;
    } else {
      movingS += p.dt;
      movingKm += dKm;
    }
    vMax = Math.max(vMax, p.speed);
    rpmMax = Math.max(rpmMax, p.rpm);
    if (p.rpm > 0) {
      // Only while the engine runs; a 0 V / 0 °C row is "no reading", not a value.
      if (p.eot > 0) eotMax = Math.max(eotMax ?? -Infinity, p.eot);
      if (p.voltage > 0) voltMin = Math.min(voltMin ?? Infinity, p.voltage);
    }
    if (p.lat != null) gpsFixes++;
  }

  return {
    km,
    movingS,
    stoppedS,
    avgMovingKmh: movingS > 0 ? (movingKm / movingS) * 3600 : null,
    vMax,
    rpmMax,
    fuelL,
    idleFuelL,
    eotMax,
    voltMin,
    gpsFixes,
  };
}
