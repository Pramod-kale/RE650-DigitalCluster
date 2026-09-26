/**
 * App-level orchestration: load persisted data, run the poller, persist on a
 * timer / on background, and expose the actions screens call. Replaces the
 * FastAPI lifespan + POST endpoints of backend/main.py.
 */
import { AppState } from 'react-native';

import {
  externalDir,
  loadExternalDir,
  pickExternalDir,
} from '@/storage/folder';
import { loadSettings, loadState, mergeStates, saveSettings, saveState } from '@/storage/persist';
import { getEntries, loadFuelLog, saveFuelLog } from '@/fuel/fuelLog';
import type { FuelEntry } from '@/fuel/fuelMath';
import { syncRidesToExternal } from '@/storage/rideLog';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '@/settings/settings';

import * as poller from './poller';
import * as ride from './ride';
import * as store from './store';

// How often odometer/tank go to disk (same as PERSIST_INTERVAL on the Pi).
const PERSIST_INTERVAL_MS = 30_000;

export type RuntimeInfo = {
  ready: boolean;
  settings: Settings;
  folderUri: string | null;
  storageError: string | null;
};

let info: RuntimeInfo = {
  ready: false,
  settings: { ...DEFAULT_SETTINGS },
  folderUri: null,
  storageError: null,
};
const listeners = new Set<() => void>();

function setInfo(patch: Partial<RuntimeInfo>) {
  info = { ...info, ...patch };
  listeners.forEach((l) => l());
}

export function subscribeRuntime(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function getRuntime(): RuntimeInfo {
  return info;
}

let lastPersist = 0;

function persistNow() {
  const err = saveState(store.toPersisted());
  lastPersist = Date.now();
  const msg = err ? `could not save: ${err.message}` : null;
  if (msg !== info.storageError) setInfo({ storageError: msg });
}

function maybePersist() {
  if (Date.now() - lastPersist >= PERSIST_INTERVAL_MS) persistNow();
}

let started = false;

/** Idempotent; call once from the root layout. */
export function init() {
  if (started) return;
  started = true;

  let settings = { ...DEFAULT_SETTINGS };
  try {
    loadExternalDir();
    settings = loadSettings();
    store.restorePersisted(loadState());
    syncRidesToExternal(null);
    loadFuelLog();
  } catch (e) {
    console.warn('[runtime] init storage failed', e);
    setInfo({ storageError: String(e) });
  }
  setInfo({ ready: true, settings, folderUri: externalDir()?.uri ?? null });

  poller.start(settings, { onCycle: maybePersist });

  // Idle-close rides and persist even while the poller is stuck reconnecting.
  setInterval(() => {
    ride.idleCheck();
    maybePersist();
  }, 5_000);

  // JS is suspended soon after the app leaves the foreground: flush now.
  AppState.addEventListener('change', (s) => {
    if (s !== 'active') {
      ride.flushRide();
      persistNow();
    }
  });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
export type RefuelInput = {
  litres: number;
  cost: number | null;
  partial: boolean;
  missedBefore: boolean;
  note: string;
};

function storageMsg(err: Error | null) {
  const msg = err ? `could not save: ${err.message}` : null;
  if (msg !== info.storageError) setInfo({ storageError: msg });
}

/**
 * Log a refuel: records the km / estimated litres since the previous refuel,
 * then resets those counters. The log is saved before the counters are reset,
 * so a crash in between can only double-count, never lose a fill.
 */
export function addRefuel(input: RefuelInput) {
  const t = Date.now();
  const tank = store.getTankRaw();
  const entry: FuelEntry = {
    id: `${t.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    t,
    ...input,
    km: tank.sinceFillKm,
    estL: tank.sinceFillL,
    factor: info.settings.fuelCorrection,
    updatedAt: t,
  };
  storageMsg(saveFuelLog([...getEntries(), entry]));
  store.markTankFull(t);
  ride.flushRide();
  persistNow(); // immediate: don't lose the marker on a crash
}

/** Edit what was entered at the pump. Distance/estimate are measured, not editable. */
export function updateRefuel(id: string, patch: Partial<RefuelInput>) {
  const now = Date.now();
  storageMsg(
    saveFuelLog(getEntries().map((e) => (e.id === id ? { ...e, ...patch, updatedAt: now } : e))),
  );
}

/**
 * Delete a refuel. Its distance and estimate are handed to the next entry (or
 * back to the running tank if it was the latest) so no km go missing.
 */
export function deleteRefuel(id: string) {
  const now = Date.now();
  const live = getEntries()
    .filter((e) => !e.deleted)
    .sort((a, b) => a.t - b.t);
  const i = live.findIndex((e) => e.id === id);
  if (i === -1) return;
  const gone = live[i];
  const next = live[i + 1];
  const updated = getEntries().map((e) => {
    if (e.id === gone.id) return { ...e, deleted: true, updatedAt: now };
    if (next && e.id === next.id) {
      // Rescale the estimate to the next entry's factor before adding it.
      const est = gone.factor > 0 ? (gone.estL * next.factor) / gone.factor : 0;
      return { ...e, km: e.km + gone.km, estL: e.estL + est, updatedAt: now };
    }
    return e;
  });
  storageMsg(saveFuelLog(updated));
  if (!next) {
    const est = gone.factor > 0 ? (gone.estL * info.settings.fuelCorrection) / gone.factor : 0;
    store.restoreTank(gone.km, est, live[i - 1]?.t ?? null);
    persistNow();
  }
}

export function resetSession() {
  store.resetSession();
}

export function updateSettings(patch: Partial<Settings>) {
  const next = sanitizeSettings({ ...info.settings, ...patch });
  const err = saveSettings(next);
  const restart =
    next.mock !== info.settings.mock ||
    next.host !== info.settings.host ||
    next.port !== info.settings.port ||
    next.pollIntervalMs !== info.settings.pollIntervalMs ||
    next.ve !== info.settings.ve ||
    next.fuelCorrection !== info.settings.fuelCorrection;
  setInfo({ settings: next, storageError: err ? `could not save: ${err.message}` : null });
  if (restart) {
    ride.closeRide(); // don't mix mock and real rows in one CSV
    poller.start(next, { onCycle: maybePersist });
  }
}

/**
 * Pick the folder that survives reinstall. If it holds data from a previous
 * install, it is merged with what's in memory (see mergeStates) and the
 * folder's settings are adopted when they are newer.
 */
export async function chooseFolder(): Promise<boolean> {
  const dir = await pickExternalDir();
  if (!dir) return false;
  try {
    store.restorePersisted(mergeStates(loadState(), store.toPersisted()));
    persistNow();
    syncRidesToExternal(ride.currentRide());
    loadFuelLog();
    saveFuelLog(getEntries());
    setInfo({ folderUri: dir.uri });
    const s = loadSettings(); // newest of internal/folder
    if (JSON.stringify(s) !== JSON.stringify(info.settings)) updateSettings(s);
    else saveSettings(info.settings);
  } catch (e) {
    setInfo({ storageError: String(e) });
  }
  return true;
}
