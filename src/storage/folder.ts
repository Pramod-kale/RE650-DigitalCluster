/**
 * Two storage roots:
 *  - internal: app-private (Paths.document). Fast and always writable, but wiped
 *    on uninstall / "Clear data".
 *  - external: a folder the user picks via the Storage Access Framework (e.g.
 *    Documents/RE650). Survives uninstall and clear-data; after a reinstall the
 *    user picks the same folder again and everything is restored from it.
 */
import { Directory, File, Paths } from 'expo-file-system';

const FOLDER_POINTER = 'external_folder.json';

let internal: Directory | null = null;
let external: Directory | null = null;

export function internalDir(): Directory {
  if (!internal) {
    internal = new Directory(Paths.document, 're650');
    internal.create({ idempotent: true, intermediates: true });
  }
  return internal;
}

export function externalDir(): Directory | null {
  return external;
}

/** Restore the previously picked folder (if its permission is still valid). */
export function loadExternalDir(): Directory | null {
  try {
    const ptr = new File(internalDir(), FOLDER_POINTER);
    if (!ptr.exists) return null;
    const { uri } = JSON.parse(ptr.textSync()) as { uri?: string };
    if (!uri) return null;
    const dir = new Directory(uri);
    dir.list(); // throws if the permission was revoked or the folder is gone
    external = dir;
  } catch (e) {
    console.warn('[folder] saved folder unavailable', e);
    external = null;
  }
  return external;
}

/** Ask the user for a folder (SAF). Returns null if they cancel. */
export async function pickExternalDir(): Promise<Directory | null> {
  try {
    const dir = await Directory.pickDirectoryAsync();
    if (!dir) return null;
    const ptr = new File(internalDir(), FOLDER_POINTER);
    ptr.write(JSON.stringify({ uri: dir.uri }));
    external = dir;
    return dir;
  } catch (e) {
    console.warn('[folder] pick cancelled/failed', e);
    return null;
  }
}

/** Find a direct child file by name (works for SAF trees and file:// dirs). */
export function findFile(dir: Directory, name: string): File | null {
  try {
    for (const item of dir.list()) {
      if (item instanceof File && item.name === name) return item;
    }
  } catch (e) {
    console.warn('[folder] list failed', e);
  }
  return null;
}

export function listFiles(dir: Directory): File[] {
  try {
    return dir.list().filter((i): i is File => i instanceof File);
  } catch (e) {
    console.warn('[folder] list failed', e);
    return [];
  }
}

export function isSaf(dir: Directory): boolean {
  return dir.uri.startsWith('content://');
}

/** Get or create a child file. SAF needs createFile(); file:// dirs can use new File(). */
export function childFile(dir: Directory, name: string, mime: string): File {
  if (!isSaf(dir)) {
    const f = new File(dir, name);
    if (!f.exists) f.create();
    return f;
  }
  return findFile(dir, name) ?? dir.createFile(name, mime);
}

/**
 * Crash-safe small-file writes via two alternating slots (`x.a.json`/`x.b.json`).
 * Each write deletes the older slot and creates it fresh, so a crash can only
 * damage the slot being written, and SAF "w" mode (which does not truncate on
 * some providers) is never used on an existing file. Readers pick the newest.
 */
const lastSlot = new Map<string, 'a' | 'b'>();

function slotName(name: string, slot: 'a' | 'b') {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? `${name}.${slot}` : `${name.slice(0, dot)}.${slot}${name.slice(dot)}`;
}

/** First write after launch: overwrite the missing or older slot, never the newest. */
function olderSlot(dir: Directory, name: string): 'a' | 'b' {
  const a = findFile(dir, slotName(name, 'a'));
  const b = findFile(dir, slotName(name, 'b'));
  if (!a) return 'a';
  if (!b) return 'b';
  return (a.lastModified ?? 0) <= (b.lastModified ?? 0) ? 'a' : 'b';
}

export function writeSlot(dir: Directory, name: string, content: string, mime: string) {
  const key = `${dir.uri}|${name}`;
  const slot = lastSlot.has(key) ? (lastSlot.get(key) === 'a' ? 'b' : 'a') : olderSlot(dir, name);
  const fileName = slotName(name, slot);
  findFile(dir, fileName)?.delete();
  childFile(dir, fileName, mime).write(content);
  lastSlot.set(key, slot);
}

/** Contents of both slots (missing/unreadable ones skipped). */
export function readSlots(dir: Directory, name: string): string[] {
  const out: string[] = [];
  for (const slot of ['a', 'b'] as const) {
    const f = findFile(dir, slotName(name, slot));
    if (!f) continue;
    try {
      out.push(f.textSync());
    } catch (e) {
      console.warn(`[folder] read ${f.name} failed`, e);
    }
  }
  return out;
}
