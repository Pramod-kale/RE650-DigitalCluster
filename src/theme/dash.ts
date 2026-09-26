/** Dark automotive palette, same tokens as frontend/src/style.css. */
export const C = {
  bg: '#0d1117',
  panel: '#161b22',
  border: '#30363d',
  fg: '#f0f6fc',
  muted: '#8b949e',
  barBg: '#21262d',
  success: '#2ea043',
  info: '#58a6ff',
  warn: '#d29922',
  danger: '#f85149',
} as const;

export type Tone = 'cool' | 'normal' | 'warn' | 'danger' | 'muted' | 'accent' | 'plain';

export const toneColor: Record<Tone, string> = {
  cool: C.info,
  normal: C.success,
  warn: C.warn,
  danger: C.danger,
  muted: C.muted,
  accent: C.info,
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
