/**
 * Recently navigated-to places (places.json, app storage only: losing them
 * costs nothing). Newest first.
 */
import type { Place } from '@/nav/navigate';

import { internalDir, readSlots, writeSlot } from './folder';

const FILE = 'places.json';
const MAX = 8;
// Places closer than this (degrees, ~50 m) count as the same one.
const SAME_DEG = 0.0005;

function isPlace(v: unknown): v is Place {
  const p = v as Place;
  return (
    !!p && typeof p.name === 'string' && typeof p.detail === 'string' &&
    typeof p.lat === 'number' && typeof p.lon === 'number'
  );
}

let cache: Place[] | null = null;

export function recentPlaces(): Place[] {
  if (cache) return cache;
  let best: { t: number; places: Place[] } | null = null;
  for (const text of readSlots(internalDir(), FILE)) {
    try {
      const v = JSON.parse(text);
      const t = typeof v?.saved_at === 'number' ? v.saved_at : 0;
      if (Array.isArray(v?.places) && (!best || t > best.t)) best = { t, places: v.places.filter(isPlace) };
    } catch (e) {
      console.warn('[places] bad JSON', e);
    }
  }
  cache = best?.places ?? [];
  return cache;
}

export function rememberPlace(p: Place) {
  const same = (q: Place) => Math.abs(q.lat - p.lat) < SAME_DEG && Math.abs(q.lon - p.lon) < SAME_DEG;
  cache = [p, ...recentPlaces().filter((q) => !same(q))].slice(0, MAX);
  try {
    writeSlot(internalDir(), FILE, JSON.stringify({ places: cache, saved_at: Date.now() }), 'application/json');
  } catch (e) {
    console.warn('[places] save failed', e);
  }
}
