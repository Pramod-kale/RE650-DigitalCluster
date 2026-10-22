import { useEffect, useState, useSyncExternalStore } from 'react';

import { getCloudStatus, subscribeCloud } from '@/cloud/sync';
import { getFuelSummary, subscribeFuel } from '@/fuel/fuelLog';

import { getRideStatus, subscribeRide } from './ride';
import { getRuntime, subscribeRuntime } from './runtime';
import { getSnapshot, subscribe } from './store';

/** Live OBD data + session/tank/odometer (what the Vue app polled from /api/*). */
export function useObd() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Settings, storage folder and storage errors. */
export function useRuntime() {
  return useSyncExternalStore(subscribeRuntime, getRuntime);
}

/** Fuel log with computed mileage (newest first). */
export function useFuel() {
  return useSyncExternalStore(subscribeFuel, getFuelSummary);
}

/** The open ride (if any) and whether it is paused. */
export function useRide() {
  return useSyncExternalStore(subscribeRide, getRideStatus);
}

/** Cloud sync connection and progress. */
export function useCloud() {
  return useSyncExternalStore(subscribeCloud, getCloudStatus);
}

/** Wall-clock time, refreshed every `ms` (for timers and countdowns). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
