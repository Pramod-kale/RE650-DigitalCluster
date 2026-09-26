/**
 * Ride CSV files: buffered append to the internal copy (often) and to the
 * picked folder (less often), plus listing / share / delete for the Rides screen.
 */
import { File, Paths, type Directory } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import {
  childFile,
  externalDir,
  findFile,
  internalDir,
  listFiles,
  readSlots,
  writeSlot,
} from './folder';
import { CSV_HEADER, csvLine, RIDE_RE, summarizeCsv, type RideSummary } from './rideSummary';

const CSV_MIME = 'text/csv';
const INDEX_FILE = 'rides_index.json';

export class RideWriter {
  readonly name: string;
  private internal: File;
  private external: File | null = null;
  private externalRoot: Directory | null = null;
  private bufInternal: string[] = [];
  private bufExternal: string[] = [];

  constructor(name: string) {
    this.name = name;
    const header = csvLine(CSV_HEADER);
    this.internal = childFile(internalDir(), name, CSV_MIME);
    this.internal.write(header);
    this.openExternal(header);
  }

  add(fields: string[]) {
    const line = csvLine(fields);
    this.bufInternal.push(line);
    this.bufExternal.push(line);
  }

  flushInternal() {
    if (this.bufInternal.length === 0) return;
    const chunk = this.bufInternal.join('');
    this.bufInternal = [];
    this.internal.write(chunk, { append: true });
  }

  /** Append pending rows to the picked folder (starting the copy if it was just picked). */
  flushExternal() {
    const ext = externalDir();
    if (!ext) return;
    if (ext !== this.externalRoot) {
      // Folder picked or changed mid-ride: seed it with everything so far.
      this.flushInternal();
      this.bufExternal = [];
      this.openExternal(this.internal.textSync());
    }
    if (!this.external || this.bufExternal.length === 0) return;
    const chunk = this.bufExternal.join('');
    this.bufExternal = [];
    this.external.write(chunk, { append: true });
  }

  flushAll() {
    this.flushInternal();
    try {
      this.flushExternal();
    } catch (e) {
      console.warn('[ride] external flush failed', e);
    }
  }

  /**
   * Rewrite the folder copy from the internal one, so any append that failed
   * mid-ride (e.g. folder briefly unavailable) doesn't leave a gap.
   */
  finish() {
    this.flushInternal();
    this.bufExternal = [];
    this.openExternal(this.internal.textSync());
  }

  summary(): RideSummary {
    this.flushInternal();
    return summarizeCsv(this.name, this.internal.textSync());
  }

  private openExternal(initial: string) {
    const ext = externalDir();
    this.externalRoot = ext;
    this.external = null;
    if (!ext) return;
    try {
      findFile(ext, this.name)?.delete();
      const f = childFile(ext, this.name, CSV_MIME);
      f.write(initial);
      this.external = f;
    } catch (e) {
      console.warn('[ride] could not create external CSV', e);
    }
  }
}

// ---------------------------------------------------------------------------
// Index of ride summaries (so the list doesn't re-parse every CSV)
// ---------------------------------------------------------------------------
function roots(): Directory[] {
  const ext = externalDir();
  return ext ? [internalDir(), ext] : [internalDir()];
}

type Index = { saved_at: number; rides: Record<string, RideSummary> };

function loadIndex(): Index {
  const merged: Index = { saved_at: 0, rides: {} };
  for (const dir of roots()) {
    for (const text of readSlots(dir, INDEX_FILE)) {
      try {
        const idx = JSON.parse(text) as Index;
        Object.assign(merged.rides, idx.rides ?? {});
      } catch {
        // damaged slot; the other one or a re-parse covers it
      }
    }
  }
  return merged;
}

function saveIndex(idx: Index) {
  idx.saved_at = Date.now();
  const text = JSON.stringify(idx);
  for (const dir of roots()) {
    try {
      writeSlot(dir, INDEX_FILE, text, 'application/json');
    } catch (e) {
      console.warn('[ride] index write failed', e);
    }
  }
}

export function recordSummary(s: RideSummary) {
  const idx = loadIndex();
  idx.rides[s.name] = s;
  saveIndex(idx);
}

/** Locate a ride's CSV, preferring the internal copy. */
function locate(name: string): File | null {
  for (const dir of roots()) {
    const f = findFile(dir, name);
    if (f) return f;
  }
  return null;
}

/**
 * All rides across both roots, newest first. Rides without a summary (e.g. the
 * app crashed mid-ride) are summarized from their CSV and added to the index.
 */
export function listRides(openRide: string | null): RideSummary[] {
  const idx = loadIndex();
  const names = new Set<string>();
  for (const dir of roots()) {
    for (const f of listFiles(dir)) if (RIDE_RE.test(f.name)) names.add(f.name);
  }
  let dirty = false;
  const out: RideSummary[] = [];
  for (const name of names) {
    let s = idx.rides[name];
    if (!s || name === openRide) {
      const f = locate(name);
      if (!f) continue;
      try {
        s = summarizeCsv(name, f.textSync());
      } catch (e) {
        console.warn(`[ride] could not read ${name}`, e);
        continue;
      }
      if (name !== openRide) {
        idx.rides[name] = s;
        dirty = true;
      }
    }
    out.push(s);
  }
  // Drop index entries whose files were deleted outside the app.
  for (const name of Object.keys(idx.rides)) {
    if (!names.has(name)) {
      delete idx.rides[name];
      dirty = true;
    }
  }
  if (dirty) saveIndex(idx);
  return out.sort((a, b) => b.startedAt - a.startedAt || b.name.localeCompare(a.name));
}

export function deleteRide(name: string) {
  for (const dir of roots()) {
    try {
      findFile(dir, name)?.delete();
    } catch (e) {
      console.warn(`[ride] delete ${name} failed`, e);
    }
  }
  const idx = loadIndex();
  delete idx.rides[name];
  saveIndex(idx);
}

export async function shareRide(name: string) {
  const src = locate(name);
  if (!src) throw new Error(`${name} not found`);
  // SAF content:// URIs can't always be shared directly; share a cache copy.
  const tmp = new File(Paths.cache, name);
  if (tmp.exists) tmp.delete();
  tmp.create();
  tmp.write(src.textSync());
  await Sharing.shareAsync(tmp.uri, { mimeType: CSV_MIME, dialogTitle: name });
}

/**
 * Copy rides the picked folder is missing or only partly has (recorded before
 * a folder was picked, or cut short by a crash) so it holds the full history.
 */
export function syncRidesToExternal(openRide: string | null) {
  const ext = externalDir();
  if (!ext) return;
  const have = new Map(listFiles(ext).map((f) => [f.name, f]));
  for (const f of listFiles(internalDir())) {
    if (!RIDE_RE.test(f.name) || f.name === openRide) continue;
    const copy = have.get(f.name);
    // Missing, or shorter than ours (partial copy from a crash) → rewrite.
    if (copy && copy.size >= f.size) continue;
    try {
      copy?.delete();
      childFile(ext, f.name, CSV_MIME).write(f.textSync());
    } catch (e) {
      console.warn(`[ride] sync ${f.name} failed`, e);
    }
  }
  saveIndex(loadIndex());
}
