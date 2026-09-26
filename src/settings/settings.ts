/**
 * User-tunable settings (replace the env vars the Pi backend used).
 */
import {
  DEFAULT_FUEL_CORRECTION_FACTOR,
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_VE,
} from '@/obd/constants';

export type Settings = {
  host: string;
  port: number;
  ve: number;
  fuelCorrection: number;
  pollIntervalMs: number;
  mock: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  host: DEFAULT_HOST,
  port: DEFAULT_PORT,
  ve: DEFAULT_VE,
  fuelCorrection: DEFAULT_FUEL_CORRECTION_FACTOR,
  pollIntervalMs: 500,
  mock: false,
};

/** Merge untrusted JSON into defaults, keeping only well-typed fields. */
export function sanitizeSettings(raw: unknown): Settings {
  const s = { ...DEFAULT_SETTINGS };
  if (raw == null || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
  if (typeof r.host === 'string' && r.host.trim()) s.host = r.host.trim();
  s.port = num(r.port, 1, 65535) ?? s.port;
  s.ve = num(r.ve, 0.1, 1.5) ?? s.ve;
  s.fuelCorrection = num(r.fuelCorrection, 0.01, 5) ?? s.fuelCorrection;
  s.pollIntervalMs = num(r.pollIntervalMs, 100, 10000) ?? s.pollIntervalMs;
  if (typeof r.mock === 'boolean') s.mock = r.mock;
  return s;
}
