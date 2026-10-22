/**
 * User-tunable settings (replace the env vars the Pi backend used).
 */
import {
  DEFAULT_FUEL_CORRECTION_FACTOR,
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_VE,
} from '@/obd/constants';
import type { BtDevice } from '@/obd/bluetooth';

// Fuel model 2: one calibration factor (VE fixed at DEFAULT_VE), default 1.0.
// Model 1 had separate VE and correction settings defaulting to 0.85 and 0.36;
// both only scale the estimate, and 0.36 read ~3x low on this bike.
const FUEL_MODEL = 2;
const DEFAULT_FUEL_CALIBRATION = 1.0;

export type Transport = 'wifi' | 'bluetooth';

export type Settings = {
  /** How the ELM327 is reached: Wi-Fi (host/port) or Bluetooth (btDevice). */
  transport: Transport;
  btDevice: BtDevice | null;
  host: string;
  port: number;
  /** Multiplies the speed-density fuel estimate; calibrated from refuels. */
  fuelCorrection: number;
  /** When fuelCorrection last changed (0 = never): newest wins across phones. */
  fuelCorrectionAt: number;
  pollIntervalMs: number;
  mock: boolean;
  fuelModel: number;
};

export const DEFAULT_SETTINGS: Settings = {
  transport: 'wifi',
  btDevice: null,
  host: DEFAULT_HOST,
  port: DEFAULT_PORT,
  fuelCorrection: DEFAULT_FUEL_CALIBRATION,
  fuelCorrectionAt: 0,
  pollIntervalMs: 500,
  mock: false,
  fuelModel: FUEL_MODEL,
};

function btDevice(v: unknown): BtDevice | null {
  if (v == null || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  if (typeof d.id !== 'string' || !d.id || (d.kind !== 'classic' && d.kind !== 'ble')) return null;
  return { id: d.id, name: typeof d.name === 'string' && d.name ? d.name : d.id, kind: d.kind };
}

const num = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined;

/**
 * Merge untrusted JSON into defaults, keeping only well-typed fields.
 * `fuelScale` is how much fuel estimates change when older settings are
 * migrated (1 when nothing changed), so running totals can be rescaled.
 */
export function migrateSettings(raw: unknown): { settings: Settings; fuelScale: number } {
  const s = { ...DEFAULT_SETTINGS };
  if (raw == null || typeof raw !== 'object') return { settings: s, fuelScale: 1 };
  const r = raw as Record<string, unknown>;
  if (r.transport === 'wifi' || r.transport === 'bluetooth') s.transport = r.transport;
  s.btDevice = btDevice(r.btDevice);
  if (typeof r.host === 'string' && r.host.trim()) s.host = r.host.trim();
  s.port = num(r.port, 1, 65535) ?? s.port;
  s.pollIntervalMs = num(r.pollIntervalMs, 100, 10000) ?? s.pollIntervalMs;
  if (typeof r.mock === 'boolean') s.mock = r.mock;
  s.fuelCorrectionAt = num(r.fuelCorrectionAt, 0, Number.MAX_SAFE_INTEGER) ?? 0;

  if (r.fuelModel === FUEL_MODEL) {
    s.fuelCorrection = num(r.fuelCorrection, 0.01, 5) ?? s.fuelCorrection;
    return { settings: s, fuelScale: 1 };
  }
  // Model 1: fold VE into the factor; an untouched 0.36 default becomes 1.0.
  const oldFactor = num(r.fuelCorrection, 0.01, 5) ?? DEFAULT_FUEL_CORRECTION_FACTOR;
  const oldVe = num(r.ve, 0.1, 1.5) ?? DEFAULT_VE;
  const base = oldFactor === DEFAULT_FUEL_CORRECTION_FACTOR ? DEFAULT_FUEL_CALIBRATION : oldFactor;
  s.fuelCorrection = Math.round(((base * oldVe) / DEFAULT_VE) * 1000) / 1000;
  return { settings: s, fuelScale: (s.fuelCorrection * DEFAULT_VE) / (oldFactor * oldVe) };
}

export function sanitizeSettings(raw: unknown): Settings {
  return migrateSettings(raw).settings;
}
