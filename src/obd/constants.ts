/**
 * Royal Enfield Interceptor 650 specs + ELM327 defaults.
 * Ported from backend/obd.py.
 */

export const DEFAULT_HOST = '192.168.0.10';
export const DEFAULT_PORT = 35000;
export const TIMEOUT_MS = 2000; // per query — low to detect drops quickly

// Interceptor 650 specs (manual p.4)
export const DISPLACEMENT_L = 0.648;
export const M_AIR = 28.97; // g/mol molar mass of air
export const R_GAS = 8.314; // J/(mol·K) ideal gas constant
export const AFR_STOICH = 14.7; // stoichiometric AFR for gasoline
export const GASOLINE_DENSITY = 745.7; // g/L

// Empirical correction for speed-density calc (ECU runs lean at cruise).
export const DEFAULT_FUEL_CORRECTION_FACTOR = 0.36;
export const DEFAULT_VE = 0.85;

// Transmission (manual p.4)
export const GEAR_RATIOS: Record<number, number> = {
  1: 2.615,
  2: 1.813,
  3: 1.429,
  4: 1.19,
  5: 1.04,
  6: 0.962,
};
export const PRIMARY_RATIO = 2.05;
export const SECONDARY_RATIO = 2.533;
export const TIRE_CIRCUM_M = 2.008; // 130/70 R18 rear tire

export type PidName = 'rpm' | 'speed' | 'tps' | 'map' | 'iat' | 'eot' | 'load';

// Order matters: critical ones first so they reach the screen faster,
// since state is updated after each individual query.
export const POLL_PIDS: readonly [number, PidName][] = [
  [0x0c, 'rpm'],
  [0x0d, 'speed'],
  [0x11, 'tps'],
  [0x0b, 'map'],
  [0x0f, 'iat'],
  [0x5c, 'eot'],
  [0x04, 'load'],
];

// Dashboard scale
export const SPEED_MAX = 200;
export const RPM_MAX = 8500;
export const RPM_REDLINE = 7000;
