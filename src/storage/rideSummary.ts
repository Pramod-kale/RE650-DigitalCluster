/**
 * Pure helpers for ride CSVs (no I/O). The first 11 columns are identical to
 * the Pi backend so scripts/analyze_ride.py and fuel_calibration.py keep
 * working; the phone appends GPS columns after them (empty without a fix).
 */

import { cleanSpeed } from '@/obd/decode';

export const CSV_HEADER = [
  'timestamp', 'rpm', 'speed', 'tps', 'map', 'iat', 'eot',
  'load', 'voltage', 'fuel_lh', 'gear',
  'lat', 'lon', 'alt', 'gps_acc',
] as const;

// Bump when summarizeCsv changes so cached summaries in the rides index are
// recomputed (2: bogus 255 km/h / 1 km/h readings are ignored).
export const SUMMARY_VERSION = 2;

export const RIDE_RE = /^ride_(\d{8})_(\d{6})(_MOCK)?\.csv$/;

export type RideSummary = {
  v?: number; // SUMMARY_VERSION it was computed with
  name: string;
  device?: string; // set on rides downloaded from another phone
  startedAt: number; // epoch ms (from filename)
  durationMin: number;
  km: number;
  fuelL: number;
  vMax: number;
  rpmMax: number;
  rows: number;
  mock: boolean;
};

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function rideFileName(d: Date, mock: boolean): string {
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `ride_${date}_${time}${mock ? '_MOCK' : ''}.csv`;
}

export function parseRideName(name: string): { startedAt: number; mock: boolean } | null {
  const m = RIDE_RE.exec(name);
  if (!m) return null;
  const [d, t] = [m[1], m[2]];
  const date = new Date(
    Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)),
    Number(t.slice(0, 2)), Number(t.slice(2, 4)), Number(t.slice(4, 6)),
  );
  return { startedAt: date.getTime(), mock: !!m[3] };
}

export function csvLine(fields: readonly string[]): string {
  return fields.join(',') + '\n';
}

// Gaps longer than this are not integrated (bike off / link lost mid-file).
export const MAX_DT_S = 5;

/** Summarize a ride CSV: integrates speed and fuel over the row timestamps. */
export function summarizeCsv(name: string, text: string): RideSummary {
  const meta = parseRideName(name) ?? { startedAt: 0, mock: name.includes('_MOCK') };
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = (lines.shift() ?? '').split(',');
  const col = (n: string) => header.indexOf(n);
  const iTs = col('timestamp');
  const iRpm = col('rpm');
  const iSpeed = col('speed');
  const iFuel = col('fuel_lh');

  let km = 0;
  let fuelL = 0;
  let vMax = 0;
  let rpmMax = 0;
  let totalS = 0;
  let rows = 0;
  let prevS: number | null = null;

  for (const line of lines) {
    const f = line.split(',');
    const ts = f[iTs]?.split(':').map(Number);
    if (!ts || ts.length !== 3 || ts.some((n) => !Number.isFinite(n))) continue;
    rows++;
    const s = ts[0] * 3600 + ts[1] * 60 + ts[2];
    const speed = cleanSpeed(Number(f[iSpeed]) || 0) ?? 0;
    const rpm = Number(f[iRpm]) || 0;
    const fuel = Number(f[iFuel]) || 0;
    vMax = Math.max(vMax, speed);
    rpmMax = Math.max(rpmMax, rpm);
    if (prevS != null) {
      let dt = s - prevS;
      if (dt < 0) dt += 86400; // crossed midnight
      if (dt > 0 && dt <= MAX_DT_S) {
        km += (speed * dt) / 3600;
        fuelL += (fuel * dt) / 3600;
        totalS += dt;
      }
    }
    prevS = s;
  }

  return {
    v: SUMMARY_VERSION,
    name,
    startedAt: meta.startedAt,
    durationMin: Math.round((totalS / 60) * 10) / 10,
    km: Math.round(km * 100) / 100,
    fuelL: Math.round(fuelL * 1000) / 1000,
    vMax,
    rpmMax,
    rows,
    mock: meta.mock,
  };
}
