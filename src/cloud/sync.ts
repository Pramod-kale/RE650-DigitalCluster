/**
 * Cross-device sync through a Turso database. Local files stay the source of
 * truth (everything works offline); a sync pushes what the cloud lacks and
 * pulls what this phone lacks:
 *  - rides: finished, non-mock rides are uploaded whole (summary + CSV);
 *    rides from other phones are downloaded into the normal ride storage;
 *    deletions travel as tombstones.
 *  - fuel log: per entry, newest edit wins (mergeEntries).
 *  - odometer / tank: one bike, merged like two storage roots (mergeStates).
 *  - fuel calibration: newest change wins.
 * One sync at a time; a request during a sync queues one more.
 */
import { currentRide } from '@/engine/ride';
import * as store from '@/engine/store';
import { getEntries, saveFuelLog } from '@/fuel/fuelLog';
import { mergeEntries, sanitizeEntry, type FuelEntry } from '@/fuel/fuelMath';
import { mergeStates, toState } from '@/storage/persist';
import { deleteRide, importRide, listRides, readRide, syncRidesToExternal } from '@/storage/rideLog';

import { clearCreds, getMeta, loadCreds, saveCreds, saveMeta } from './config';
import { fuelChanged, fuelToUpload, planRides } from './plan';
import { Q, SCHEMA } from './schema';
import { execute, TursoError, type Creds, type Row, type Stmt } from './turso';

// Per sync, so a new phone catching up on a long history doesn't stall.
const MAX_DOWNLOADS = 20;


/** What sync needs from the app runtime (kept as callbacks to avoid an import cycle). */
export type CloudHost = {
  getFuelCalibration(): { value: number; at: number };
  /** Apply a calibration from another phone (rescales the running totals). */
  setFuelCalibration(value: number, at: number): void;
  persist(): void;
};

export type CloudStatus = {
  configured: boolean;
  url: string | null;
  deviceName: string;
  syncing: boolean;
  lastSyncAt: number | null;
  lastResult: string | null;
  lastError: string | null;
};

let host: CloudHost | null = null;
let creds: Creds | null = null;
let schemaReady = false;
let inflight: Promise<void> | null = null;
let again = false;

let status: CloudStatus = {
  configured: false,
  url: null,
  deviceName: '',
  syncing: false,
  lastSyncAt: null,
  lastResult: null,
  lastError: null,
};
const listeners = new Set<() => void>();

function setStatus(patch: Partial<CloudStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}

export function subscribeCloud(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function getCloudStatus(): CloudStatus {
  return status;
}

/** Once at startup, after local storage is loaded. */
export async function initCloud(h: CloudHost) {
  host = h;
  const m = getMeta();
  setStatus({ deviceName: m.deviceName, lastSyncAt: m.lastSyncAt });
  creds = await loadCreds();
  setStatus({ configured: creds != null, url: creds?.url ?? null });
  requestSync();
}

/** Check the credentials with a trivial query, then keep them and sync. */
export async function connect(url: string, token: string): Promise<string | null> {
  const next = { url: url.trim(), token: token.trim() || (creds?.token ?? '') };
  if (!/^(libsql|https?|wss?):\/\/\S+$/.test(next.url)) return 'Enter the database URL (libsql://…)';
  try {
    await execute(next, [{ sql: 'SELECT 1' }]);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  await saveCreds(next);
  creds = next;
  schemaReady = false;
  setStatus({ configured: true, url: next.url, lastError: null });
  requestSync();
  return null;
}

/** Forget the credentials on this phone. Local data and the cloud copy stay. */
export async function disconnect() {
  await clearCreds();
  creds = null;
  setStatus({ configured: false, url: null, lastError: null, lastResult: null });
}

export function setDeviceName(name: string) {
  const n = name.trim();
  if (!n) return;
  saveMeta({ deviceName: n });
  setStatus({ deviceName: n });
  requestSync();
}

/** A ride was deleted here: tell other phones on the next sync. */
export function rideDeleted(name: string) {
  const m = getMeta();
  if (!m.pendingDeletes.includes(name)) saveMeta({ pendingDeletes: [...m.pendingDeletes, name] });
  requestSync();
}

/** Sync soon (no-op when not configured). Resolves when this request is done. */
export function requestSync(): Promise<void> {
  if (!creds || !host) return Promise.resolve();
  if (inflight) {
    again = true;
    return inflight;
  }
  inflight = (async () => {
    do {
      again = false;
      await syncOnce();
    } while (again);
    inflight = null;
  })();
  return inflight;
}

async function syncOnce() {
  const c = creds;
  if (!c || !host) return;
  setStatus({ syncing: true });
  try {
    const result = await run(c, host);
    const t = Date.now();
    saveMeta({ lastSyncAt: t });
    setStatus({ lastSyncAt: t, lastResult: result, lastError: null });
  } catch (e) {
    console.warn('[cloud] sync failed', e);
    setStatus({ lastError: e instanceof TursoError ? e.message : String(e) });
  } finally {
    setStatus({ syncing: false });
  }
}

function parse(row: Row | undefined, col: string): unknown {
  try {
    return row ? JSON.parse(String(row[col])) : null;
  } catch {
    return null;
  }
}

async function run(c: Creds, h: CloudHost): Promise<string> {
  const m = getMeta();
  const now = Date.now();
  if (!schemaReady) {
    await execute(c, SCHEMA);
    schemaReady = true;
  }

  // One round trip: register this phone and read everything small.
  const [, devices, bikeRows, fuelRows, rideRows] = await execute(c, [
    Q.touchDevice(m.deviceId, m.deviceName, now),
    Q.devices(),
    Q.bike(),
    Q.fuel(),
    Q.rides(),
  ]);
  const writes: Stmt[] = [];

  // Calibration first, so the tank litres below are merged on one factor.
  const calRow = bikeRows.find((r) => r.key === 'calibration');
  const calAt = calRow ? Number(calRow.updated_at) : -1;
  const cal = h.getFuelCalibration();
  const remoteCal = (parse(calRow, 'data') as { fuelCorrection?: unknown } | null)?.fuelCorrection;
  if (calAt > cal.at && typeof remoteCal === 'number' && remoteCal > 0) {
    if (remoteCal !== cal.value) h.setFuelCalibration(remoteCal, calAt);
  } else if (cal.at > calAt) {
    writes.push(Q.putBike('calibration', cal.at, { fuelCorrection: cal.value }));
  }

  // Odometer and tank.
  const remoteState = parse(bikeRows.find((r) => r.key === 'state'), 'data');
  const mine = store.toPersisted();
  const theirs =
    remoteState && typeof remoteState === 'object'
      ? toState(remoteState as Record<string, unknown>)
      : null;
  const merged = mergeStates(mine, theirs) ?? mine;
  if (
    merged.km_total !== mine.km_total ||
    merged.tank_last_fill_t !== mine.tank_last_fill_t ||
    merged.tank_since_fill_km !== mine.tank_since_fill_km
  ) {
    store.restorePersisted(merged);
    h.persist();
  }
  writes.push(Q.putBike('state', now, { ...merged, saved_at: now }));

  // Fuel log.
  const remoteAt = new Map<string, number>();
  const remoteEntries: FuelEntry[] = [];
  for (const r of fuelRows) {
    const e = sanitizeEntry(parse(r, 'data'));
    if (e) {
      remoteEntries.push(e);
      remoteAt.set(e.id, Number(r.updated_at));
    }
  }
  const curFuel = getEntries();
  const mergedFuel = mergeEntries(curFuel, remoteEntries);
  if (fuelChanged(curFuel, mergedFuel)) saveFuelLog(mergedFuel);
  const fuelUp = fuelToUpload(mergedFuel, remoteAt);
  for (const e of fuelUp) writes.push(Q.putFuel(e.id, e.updatedAt, e));

  // Rides: deletions both ways, then uploads and downloads.
  const open = currentRide();
  const local = listRides(open);
  const plan = planRides(
    local,
    rideRows.map((r) => ({
      name: String(r.name),
      deviceId: String(r.device_id),
      deletedAt: r.deleted_at == null ? null : Number(r.deleted_at),
    })),
    m.pendingDeletes,
    open,
  );
  for (const name of plan.tombstone) writes.push(Q.deleteRide(name, m.deviceId, now));
  for (const name of plan.deleteLocal) deleteRide(name);

  if (writes.length) await execute(c, writes);
  // Keep deletions queued while this sync ran.
  saveMeta({ pendingDeletes: getMeta().pendingDeletes.filter((n) => !plan.tombstone.includes(n)) });

  // One ride per request: a long ride is a few hundred KB of CSV.
  let up = 0;
  for (const name of plan.upload) {
    const csv = readRide(name);
    const s = local.find((r) => r.name === name);
    if (csv == null || !s) continue;
    await execute(c, [Q.putRide(name, m.deviceId, s.startedAt, s, csv)]);
    up++;
  }

  const deviceNames = new Map(devices.map((d) => [String(d.id), String(d.name)]));
  let down = 0;
  for (const name of plan.download.slice(0, MAX_DOWNLOADS)) {
    const [rows] = await execute(c, [Q.rideCsv(name)]);
    const r = rows[0];
    if (!r || r.csv == null) continue;
    importRide(name, String(r.csv), deviceNames.get(String(r.device_id)) ?? 'another phone');
    down++;
  }
  if (down > 0) syncRidesToExternal(open);
  // A new phone catching up: carry on with the next batch straight away.
  if (down > 0 && plan.download.length > down) again = true;

  const parts = [
    up && `${up} ride${up === 1 ? '' : 's'} up`,
    down && `${down} ride${down === 1 ? '' : 's'} down`,
    plan.download.length > down && `${plan.download.length - down} more to fetch`,
    fuelUp.length && `${fuelUp.length} refuel${fuelUp.length === 1 ? '' : 's'} up`,
    plan.deleteLocal.length && `${plan.deleteLocal.length} deleted`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'up to date';
}
