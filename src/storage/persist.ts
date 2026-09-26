/**
 * state.json (odometer + tank) and settings.json, kept in both storage roots.
 *
 * The app's copy and the folder's copy are merged by meaning, not by
 * timestamp, so a fresh install (which starts saving zeros before the folder
 * is picked) never wins over the real history in the folder: see mergeStates.
 * For settings, newest saved_at wins.
 */
import type { Directory } from 'expo-file-system';

import type { PersistedState } from '@/engine/store';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '@/settings/settings';

import { externalDir, internalDir, readSlots, writeSlot } from './folder';

const STATE_FILE = 'state.json';
const SETTINGS_FILE = 'settings.json';
const JSON_MIME = 'application/json';

function roots(): Directory[] {
  const ext = externalDir();
  return ext ? [internalDir(), ext] : [internalDir()];
}

/** All parseable copies of `name` across both slots of `dir`. */
function readJson(dir: Directory, name: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const text of readSlots(dir, name)) {
    try {
      const v = JSON.parse(text);
      if (v && typeof v === 'object') out.push(v);
    } catch (e) {
      console.warn(`[persist] bad JSON in ${name}`, e);
    }
  }
  return out;
}

/** Write to every root; returns the first error (external failures are non-fatal). */
function writeAll(name: string, content: string): Error | null {
  let err: Error | null = null;
  for (const dir of roots()) {
    try {
      writeSlot(dir, name, content, JSON_MIME);
    } catch (e) {
      console.warn(`[persist] write ${name} to ${dir.uri} failed`, e);
      err ??= e instanceof Error ? e : new Error(String(e));
    }
  }
  return err;
}

const num = (v: unknown, dflt = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function toState(raw: Record<string, unknown>): PersistedState {
  return {
    km_total: num(raw.km_total),
    fuel_total_l: num(raw.fuel_total_l),
    started_at: numOrNull(raw.started_at),
    tank_since_fill_l: num(raw.tank_since_fill_l),
    tank_since_fill_km: num(raw.tank_since_fill_km),
    tank_last_fill_t: numOrNull(raw.tank_last_fill_t),
    saved_at: num(raw.saved_at),
  };
}

/**
 * Combine two copies: the odometer only ever grows, so the larger km wins; the
 * tank block comes from whichever copy has the later fill marker (ties → more km).
 */
export function mergeStates(
  a: PersistedState | null,
  b: PersistedState | null,
): PersistedState | null {
  if (!a || !b) return a ?? b;
  const odo = b.km_total > a.km_total ? b : a;
  const fa = a.tank_last_fill_t ?? 0;
  const fb = b.tank_last_fill_t ?? 0;
  const tank = fb > fa || (fb === fa && b.tank_since_fill_km > a.tank_since_fill_km) ? b : a;
  const starts = [a.started_at, b.started_at].filter((v): v is number => v != null);
  return {
    km_total: odo.km_total,
    fuel_total_l: odo.fuel_total_l,
    started_at: starts.length ? Math.min(...starts) : null,
    tank_since_fill_l: tank.tank_since_fill_l,
    tank_since_fill_km: tank.tank_since_fill_km,
    tank_last_fill_t: tank.tank_last_fill_t,
    saved_at: Math.max(a.saved_at, b.saved_at),
  };
}

/**
 * Within one root the two slots are successive saves, so the newest one is the
 * truth (a deleted refuel may legitimately move the fill marker back). Only
 * the copies of different roots, which can diverge, are merged.
 */
export function loadState(): PersistedState | null {
  let merged: PersistedState | null = null;
  for (const dir of roots()) {
    let newest: PersistedState | null = null;
    for (const raw of readJson(dir, STATE_FILE)) {
      const s = toState(raw);
      if (!newest || s.saved_at > newest.saved_at) newest = s;
    }
    merged = mergeStates(merged, newest);
  }
  return merged;
}

export function saveState(s: PersistedState): Error | null {
  return writeAll(STATE_FILE, JSON.stringify(s, null, 2));
}

export function loadSettings(): Settings {
  let best: { saved_at: number; raw: Record<string, unknown> } | null = null;
  for (const dir of roots()) {
    for (const raw of readJson(dir, SETTINGS_FILE)) {
      const savedAt = num(raw.saved_at);
      if (!best || savedAt > best.saved_at) best = { saved_at: savedAt, raw };
    }
  }
  return best ? sanitizeSettings(best.raw) : { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): Error | null {
  return writeAll(SETTINGS_FILE, JSON.stringify({ ...s, saved_at: Date.now() }, null, 2));
}
