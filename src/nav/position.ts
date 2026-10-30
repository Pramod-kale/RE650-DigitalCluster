/**
 * Where the rider is, for the dashboard map and navigation, with or without a
 * ride: the live ride track while one records (so mock rides work too),
 * otherwise a foreground location watch. The watch runs only while something
 * is subscribed (the dashboard map is mounted).
 */
import * as Location from 'expo-location';

import { getTrack, isRecording, requestPermission, subscribeTrack } from '@/engine/gps';

import { bearingDeg, type LatLon } from './trackback';

export type Here = LatLon & { heading: number | null };

const WATCH_INTERVAL_MS = 2000;
const WATCH_DISTANCE_M = 10;
// Below this the phone's course is noise.
const MIN_COURSE_MS = 2;

let watched: Here | null = null;
let current: Here | null = null;
let watch: Location.LocationSubscription | null = null;
let watchToken = 0;
let unsubTrack: (() => void) | null = null;
const listeners = new Set<() => void>();

function fromTrack(): Here | null {
  const t = getTrack();
  if (!isRecording() || !t.length) return null;
  const ll = (i: number): LatLon => ({ lat: t[i][1], lon: t[i][0] });
  const here = ll(t.length - 1);
  return { ...here, heading: t.length > 1 ? bearingDeg(ll(t.length - 2), here) : null };
}

function update() {
  const next = fromTrack() ?? watched;
  if (next === current || (next && current && next.lat === current.lat && next.lon === current.lon)) return;
  current = next;
  listeners.forEach((l) => l());
}

async function startWatch() {
  const token = ++watchToken;
  if (!(await requestPermission())) return;
  try {
    const sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: WATCH_INTERVAL_MS, distanceInterval: WATCH_DISTANCE_M },
      (l) => {
        const { latitude, longitude, heading, speed } = l.coords;
        const course = heading != null && heading >= 0 && speed != null && speed >= MIN_COURSE_MS ? heading : null;
        watched = { lat: latitude, lon: longitude, heading: course };
        update();
      },
    );
    if (token === watchToken) watch = sub;
    else sub.remove(); // everyone unsubscribed while it was starting
  } catch (e) {
    console.warn('[position] watch failed', e);
  }
}

function stopWatch() {
  watchToken++;
  watch?.remove();
  watch = null;
}

export function subscribePosition(l: () => void) {
  listeners.add(l);
  if (listeners.size === 1) {
    unsubTrack = subscribeTrack(update);
    update();
    void startWatch();
  }
  return () => {
    listeners.delete(l);
    if (listeners.size) return;
    unsubTrack?.();
    unsubTrack = null;
    stopWatch();
  };
}

/** Latest position, or null before the first fix. Stable between changes (for useSyncExternalStore). */
export function getPosition(): Here | null {
  return current;
}
