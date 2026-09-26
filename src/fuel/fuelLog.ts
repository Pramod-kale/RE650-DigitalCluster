/**
 * Fuel log storage + in-memory copy for the UI. Saved as fuel_log.{a,b}.json
 * in both storage roots (app + picked folder); copies are merged by entry id.
 */
import type { Directory } from 'expo-file-system';

import { externalDir, internalDir, readSlots, writeSlot } from '@/storage/folder';

import { mergeEntries, sanitizeEntry, summarizeFuel, type FuelEntry, type FuelSummary } from './fuelMath';

const FILE = 'fuel_log.json';

let entries: FuelEntry[] = [];
let summary: FuelSummary = summarizeFuel([]);
const listeners = new Set<() => void>();

function roots(): Directory[] {
  const ext = externalDir();
  return ext ? [internalDir(), ext] : [internalDir()];
}

function readAll(): FuelEntry[][] {
  const lists: FuelEntry[][] = [];
  for (const dir of roots()) {
    for (const text of readSlots(dir, FILE)) {
      try {
        const raw = JSON.parse(text) as { entries?: unknown[] };
        lists.push((raw.entries ?? []).map(sanitizeEntry).filter((e): e is FuelEntry => e != null));
      } catch (e) {
        console.warn('[fuel] bad fuel log copy', e);
      }
    }
  }
  return lists;
}

function set(next: FuelEntry[]) {
  entries = next;
  summary = summarizeFuel(entries);
  listeners.forEach((l) => l());
}

/** (Re)load from disk, merging with what's in memory (e.g. after picking a folder). */
export function loadFuelLog() {
  set(mergeEntries(entries, ...readAll()));
}

/** Write to every root. Returns the first error; the internal copy is written first. */
export function saveFuelLog(next: FuelEntry[]): Error | null {
  set(next);
  const text = JSON.stringify({ saved_at: Date.now(), entries: next });
  let err: Error | null = null;
  for (const dir of roots()) {
    try {
      writeSlot(dir, FILE, text, 'application/json');
    } catch (e) {
      console.warn(`[fuel] write to ${dir.uri} failed`, e);
      err ??= e instanceof Error ? e : new Error(String(e));
    }
  }
  return err;
}

export function getEntries(): FuelEntry[] {
  return entries;
}

export function subscribeFuel(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function getFuelSummary(): FuelSummary {
  return summary;
}
