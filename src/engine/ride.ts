/**
 * Ride lifecycle. The Pi opened one CSV per process start; on the phone a ride
 * starts on the first fresh sample and ends after RIDE_IDLE_MS without one.
 */
import { recordSummary, RideWriter } from '@/storage/rideLog';
import { rideFileName } from '@/storage/rideSummary';

const RIDE_IDLE_MS = 120_000;
const INTERNAL_FLUSH_MS = 5_000;
const EXTERNAL_FLUSH_MS = 30_000;

let writer: RideWriter | null = null;
let lastFreshT = 0;
let lastInternalFlush = 0;
let lastExternalFlush = 0;

export function currentRide(): string | null {
  return writer?.name ?? null;
}

/** Called once per poll cycle with the CSV row, or null when data is stale. */
export function tick(row: string[] | null, mock: boolean, t = Date.now()) {
  try {
    if (row) {
      if (!writer) {
        writer = new RideWriter(rideFileName(new Date(t), mock));
        lastInternalFlush = lastExternalFlush = t;
      }
      writer.add(row);
      lastFreshT = t;
    } else if (idleCheck(t)) {
      return;
    }
    if (!writer) return;
    if (t - lastInternalFlush >= INTERNAL_FLUSH_MS) {
      writer.flushInternal();
      lastInternalFlush = t;
    }
    if (t - lastExternalFlush >= EXTERNAL_FLUSH_MS) {
      writer.flushExternal();
      lastExternalFlush = t;
    }
  } catch (e) {
    // Storage trouble must never stop the poller.
    console.warn('[ride] tick failed', e);
  }
}

/**
 * Close the ride after RIDE_IDLE_MS without fresh data. Also called from a
 * timer, since the poller skips tick() while it is reconnecting.
 */
export function idleCheck(t = Date.now()): boolean {
  if (writer && t - lastFreshT > RIDE_IDLE_MS) {
    closeRide();
    return true;
  }
  return false;
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
  if (!w) return;
  try {
    w.finish();
    recordSummary(w.summary());
  } catch (e) {
    console.warn('[ride] close failed', e);
  }
}
