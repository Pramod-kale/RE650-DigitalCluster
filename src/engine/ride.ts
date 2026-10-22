/**
 * Ride lifecycle. The Pi opened one CSV per process start; on the phone a ride
 * starts when the engine is first seen running. After RIDE_IDLE_MS with the
 * engine off (or no data at all) it is paused and the rider is asked whether
 * to end it. The engine running again resumes it in the same CSV, so a tea stop
 * doesn't split the trip. It ends on "End", or after PAUSE_AUTO_END_MS unless
 * the rider chose "Keep".
 *
 * "Running" rather than "fresh data" because with the ignition on and the
 * engine off the ECU keeps answering (rpm 0), so data alone never goes stale.
 *
 * If the bike data stops but GPS says the phone is moving (dongle didn't come
 * back after a stop), the ride counts as active: it is resumed / kept open,
 * the route is logged in GPS-only rows (speed from GPS, OBD columns empty)
 * and the rider is told. A ride without GPS fixes gets a warning too.
 */
import { recordSummary, RideWriter } from '@/storage/rideLog';
import { rideFileName } from '@/storage/rideSummary';

import * as gps from './gps';
import {
  clearGpsLost,
  clearNoBikeData,
  clearRidePaused,
  showGpsLost,
  showNoBikeData,
  showRidePaused,
} from './notify';

const RIDE_IDLE_MS = 120_000;
// Bike data older than this counts as missing for GPS-only logging.
const OBD_FRESH_MS = 3_000;
// GPS speed at or above this means the bike is being ridden, not walked.
const MOVING_KMH = 10;
// No fix for this long while riding: warn (tunnels shorter than this stay quiet).
const GPS_LOST_MS = 30_000;
export const PAUSE_AUTO_END_MS = 60 * 60_000;
const INTERNAL_FLUSH_MS = 5_000;
const EXTERNAL_FLUSH_MS = 30_000;

export type RideStatus = {
  name: string | null;
  pausedAt: number | null; // set while paused
  kept: boolean; // rider chose "Keep": no auto-end
  noBike: boolean; // moving with no bike data: logging GPS only
  gpsLost: boolean; // recording without a GPS fix for GPS_LOST_MS
};

let writer: RideWriter | null = null;
let lastRunningT = 0;
let lastInternalFlush = 0;
let lastExternalFlush = 0;
let rideMock = false;
let lastRowT = 0; // last OBD row (engine running or not)
let lastMovingT = 0; // last GPS fix at riding speed while bike data was missing

let status: RideStatus = { name: null, pausedAt: null, kept: false, noBike: false, gpsLost: false };
const listeners = new Set<() => void>();

function setStatus(patch: Partial<RideStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}

export function subscribeRide(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function getRideStatus(): RideStatus {
  return status;
}

export function currentRide(): string | null {
  return writer?.name ?? null;
}

const RPM_COL = 1;
const SPEED_COL = 2;
const OBD_COLS = 11; // timestamp + 10 values, see CSV_HEADER

function clock(t: number): string {
  const d = new Date(t);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

function resume() {
  if (status.pausedAt == null) return;
  setStatus({ pausedAt: null, kept: false });
  void clearRidePaused();
}

function maybeFlush(t: number) {
  if (!writer) return;
  if (t - lastInternalFlush >= INTERNAL_FLUSH_MS) {
    writer.flushInternal();
    lastInternalFlush = t;
  }
  if (t - lastExternalFlush >= EXTERNAL_FLUSH_MS) {
    writer.flushExternal();
    lastExternalFlush = t;
  }
}

/** Called once per poll cycle with the CSV row, or null when data is stale. */
export function tick(row: string[] | null, mock: boolean, t = Date.now()) {
  try {
    const running = row != null && Number(row[RPM_COL]) > 0;
    if (row) {
      lastRowT = t;
      if (status.noBike) {
        setStatus({ noBike: false });
        void clearNoBikeData();
      }
    }
    if (row && (writer || running)) {
      if (!writer) {
        writer = new RideWriter(rideFileName(new Date(t), mock));
        rideMock = mock;
        lastInternalFlush = lastExternalFlush = t;
        setStatus({ name: writer.name, pausedAt: null, kept: false, noBike: false, gpsLost: false });
        gps.start();
      } else if (running) {
        resume();
      }
      // Engine-off rows are still written while the ignition is on (battery
      // voltage is useful), but only a running engine keeps the ride active.
      writer.add([...row, ...gps.csvFields(mock, t)]);
      if (running) lastRunningT = t;
    }
    if (!running && idleCheck(t)) {
      return;
    }
    maybeFlush(t);
  } catch (e) {
    // Storage trouble must never stop the poller.
    console.warn('[ride] tick failed', e);
  }
}

/**
 * Called with every real GPS fix. While bike data is missing and the phone
 * moves at riding speed, keeps the ride active and logs GPS-only rows (also
 * through short stops, until RIDE_IDLE_MS without movement).
 */
export function gpsTick(speedKmh: number | null, t = Date.now()) {
  try {
    if (!writer || rideMock || t - lastRowT < OBD_FRESH_MS) return;
    if (speedKmh != null && speedKmh >= MOVING_KMH) {
      lastMovingT = t;
      lastRunningT = t;
      resume();
      if (!status.noBike) {
        setStatus({ noBike: true });
        void showNoBikeData();
      }
    }
    if (lastMovingT === 0 || t - lastMovingT > RIDE_IDLE_MS) return;
    const row: string[] = new Array(OBD_COLS).fill('');
    row[0] = clock(t);
    row[SPEED_COL] = speedKmh == null ? '' : speedKmh.toFixed(0);
    writer.add([...row, ...gps.csvFields(false, t)]);
    maybeFlush(t);
  } catch (e) {
    console.warn('[ride] gps tick failed', e);
  }
}
gps.onFix(gpsTick);

/** Warn once when a recording ride has had no GPS fix for GPS_LOST_MS; clear when it's back. */
function gpsWatch(t: number) {
  const lost = writer != null && !rideMock && status.pausedAt == null && gps.fixAge(t) > GPS_LOST_MS;
  if (lost) gps.retry(); // location may have failed to start (app was in the background)
  if (lost && !status.gpsLost) {
    setStatus({ gpsLost: true });
    void showGpsLost();
  } else if (!lost && status.gpsLost) {
    setStatus({ gpsLost: false });
    void clearGpsLost();
  }
}

/**
 * Pause the ride after RIDE_IDLE_MS without the engine running; end it once paused
 * for PAUSE_AUTO_END_MS (unless kept). Returns true if the ride was closed.
 * Also called from a timer, since the poller skips tick() while reconnecting.
 */
export function idleCheck(t = Date.now()): boolean {
  gpsWatch(t);
  if (!writer) return false;
  if (status.pausedAt == null) {
    if (t - lastRunningT > RIDE_IDLE_MS) {
      flushRide();
      setStatus({ pausedAt: t, kept: false });
      void showRidePaused(PAUSE_AUTO_END_MS / 60_000);
    }
    return false;
  }
  if (!status.kept && t - status.pausedAt > PAUSE_AUTO_END_MS) {
    closeRide();
    return true;
  }
  return false;
}

/** Rider chose "Keep": stay paused until data returns or they end it. */
export function keepRide() {
  if (!writer || status.pausedAt == null) return;
  setStatus({ kept: true });
  void clearRidePaused();
}

/** Push everything to disk now (app backgrounded / tank marked). */
export function flushRide() {
  try {
    writer?.flushAll();
  } catch (e) {
    console.warn('[ride] flush failed', e);
  }
}

export function closeRide() {
  const w = writer;
  writer = null;
  lastMovingT = 0;
  gps.stop();
  void clearRidePaused();
  if (status.noBike) void clearNoBikeData();
  if (status.gpsLost) void clearGpsLost();
  if (status.name != null || status.noBike || status.gpsLost) {
    setStatus({ name: null, pausedAt: null, kept: false, noBike: false, gpsLost: false });
  }
  if (!w) return;
  try {
    w.finish();
    recordSummary(w.summary());
  } catch (e) {
    console.warn('[ride] close failed', e);
  }
}
