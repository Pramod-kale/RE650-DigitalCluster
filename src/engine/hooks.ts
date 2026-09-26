import { useSyncExternalStore } from 'react';

import { getFuelSummary, subscribeFuel } from '@/fuel/fuelLog';

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
