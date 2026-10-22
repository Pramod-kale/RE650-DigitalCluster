/**
 * Neutral dark palette (the design canvas's "Palette" board). Greys carry the
 * layout; the four accents are used only for meaning, never as solid fills.
 */
export const C = {
  bg: '#0f1012',
  panel: '#17181b', // cards
  border: '#232428', // card edges
  line: '#2e2f33', // inputs, chips, hatching, empty bars
  outline: '#52525b', // emphasised outlines (gear box, primary buttons)
  fg: '#e4e4e7',
  bright: '#fafafa',
  muted: '#a1a1aa', // labels
  dim: '#71717a', // units, secondary labels
  barBg: '#2e2f33',
  barFill: '#d4d4d8', // lit RPM ticks below the warning zone
  success: '#22d3ee', // cyan: connected / OK, ride start
  info: '#93c5fd', // light blue: you are here, info
  warn: '#f0a35e', // orange: high, warning
  danger: '#f0716a', // red: critical, redline, recording
} as const;

/** Faint tint behind an accent outline (bars and badges are never solid). */
export function tint(color: string, alpha = 0.16): string {
  const n = parseInt(color.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Dashboard thresholds: orange / red zones. */
export const ZONES = {
  speed: { warn: 80, danger: 100 }, // km/h, strictly above
  rpm: { warn: 5500, danger: 7000 }, // strictly above
  pct: { warn: 60, danger: 85 }, // throttle / load, at or above
} as const;

export function speedColor(kmh: number): string {
  return kmh > ZONES.speed.danger ? C.danger : kmh > ZONES.speed.warn ? C.warn : C.fg;
}

export function rpmColor(rpm: number): string {
  return rpm > ZONES.rpm.danger ? C.danger : rpm > ZONES.rpm.warn ? C.warn : C.fg;
}

/** null below the warning zone. */
export function pctZone(v: number): string | null {
  return v >= ZONES.pct.danger ? C.danger : v >= ZONES.pct.warn ? C.warn : null;
}

/**
 * Text sizes for the secondary screens (Settings, Rides, Ride, Fuel, Refuel),
 * big enough to read on the handlebar at arm's length. The dashboard sets its
 * own sizes.
 */
export const F = {
  micro: 13, // section / stat labels (letter-spaced caps)
  hint: 15, // explanations, file names
  sub: 16, // secondary lines
  body: 18, // labels, values, buttons, inputs
  title: 19, // card titles
  stat: 22, // stat values
  big: 30, // headline numbers
} as const;

export type Tone = 'cool' | 'normal' | 'warn' | 'danger' | 'muted' | 'accent' | 'plain';

export const toneColor: Record<Tone, string> = {
  cool: C.info,
  normal: C.fg,
  warn: C.warn,
  danger: C.danger,
  muted: C.muted,
  accent: C.fg,
  plain: C.fg,
};

/** Oil temp zones (App.vue eotClass). */
export function eotTone(v: number): Tone {
  if (v < 60) return 'cool';
  if (v <= 105) return 'normal';
  if (v <= 115) return 'warn';
  return 'danger';
}

/** Battery zones (App.vue voltClass). */
export function voltTone(v: number, connected: boolean): Tone {
  if (!connected) return 'muted';
  if (v < 12.0) return 'danger';
  if (v < 13.0) return 'warn';
  return 'normal';
}

export function fmt(v: number | null | undefined, digits = 0, dash = '—'): string {
  if (v == null || Number.isNaN(v)) return dash;
  return Number(v).toFixed(digits);
}
