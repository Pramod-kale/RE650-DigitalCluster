/**
 * Pure sync decisions (no I/O), so the rules can be tested on their own.
 */
import type { FuelEntry } from '@/fuel/fuelMath';
import type { RideSummary } from '@/storage/rideSummary';

export type RemoteRide = { name: string; deviceId: string; deletedAt: number | null };

export type RidePlan = {
  /** Tell the cloud these were deleted here. */
  tombstone: string[];
  /** Deleted on another phone: remove the local copy. */
  deleteLocal: string[];
  /** Recorded here and not in the cloud yet. */
  upload: string[];
  /** In the cloud, not here: newest first. */
  download: string[];
};

export function planRides(
  local: RideSummary[],
  remote: RemoteRide[],
  pendingDeletes: string[],
  openRide: string | null,
): RidePlan {
  const remoteByName = new Map(remote.map((r) => [r.name, r]));
  const localNames = new Set(local.map((r) => r.name));
  const pending = new Set(pendingDeletes);

  const deleteLocal = remote
    .filter((r) => r.deletedAt != null && localNames.has(r.name) && r.name !== openRide)
    .map((r) => r.name);
  const gone = new Set(deleteLocal);

  const upload = local
    .filter(
      (r) =>
        !r.mock && // test data stays on the phone
        r.name !== openRide && // uploaded once it's finished
        !remoteByName.has(r.name) &&
        !pending.has(r.name) &&
        !gone.has(r.name),
    )
    .map((r) => r.name);

  const download = remote
    .filter((r) => r.deletedAt == null && !localNames.has(r.name) && !pending.has(r.name))
    .map((r) => r.name)
    .sort()
    .reverse(); // names are ride_YYYYMMDD_HHMMSS: newest first

  return { tombstone: [...pending], deleteLocal, upload, download };
}

/** Entries the cloud is missing or has an older version of. */
export function fuelToUpload(merged: FuelEntry[], remote: Map<string, number>): FuelEntry[] {
  return merged.filter((e) => {
    const at = remote.get(e.id);
    return at == null || at < e.updatedAt;
  });
}

/** True if `next` differs from `cur` (by id and version). */
export function fuelChanged(cur: FuelEntry[], next: FuelEntry[]): boolean {
  if (cur.length !== next.length) return true;
  const at = new Map(cur.map((e) => [e.id, e.updatedAt]));
  return next.some((e) => at.get(e.id) !== e.updatedAt);
}
