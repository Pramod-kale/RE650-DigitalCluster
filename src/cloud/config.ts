/**
 * Cloud sync configuration. The Turso URL and token live in the OS secure
 * store (Android Keystore / iOS Keychain), never in settings JSON: that is
 * mirrored as plain text to the picked storage folder. Device identity and
 * sync bookkeeping are app-private (cloud.json in the internal root only).
 */
import * as Device from 'expo-device';
import { File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import { internalDir } from '@/storage/folder';

import type { Creds } from './turso';

const URL_KEY = 'turso_url';
const TOKEN_KEY = 'turso_token';
const META_FILE = 'cloud.json';

export type CloudMeta = {
  deviceId: string;
  deviceName: string;
  lastSyncAt: number | null;
  /** Rides deleted here that the cloud hasn't been told about yet. */
  pendingDeletes: string[];
};

export async function loadCreds(): Promise<Creds | null> {
  try {
    const [url, token] = await Promise.all([
      SecureStore.getItemAsync(URL_KEY),
      SecureStore.getItemAsync(TOKEN_KEY),
    ]);
    return url ? { url, token: token ?? '' } : null;
  } catch (e) {
    console.warn('[cloud] could not read credentials', e);
    return null;
  }
}

export async function saveCreds(c: Creds) {
  await SecureStore.setItemAsync(URL_KEY, c.url.trim());
  await SecureStore.setItemAsync(TOKEN_KEY, c.token.trim());
}

export async function clearCreds() {
  await Promise.all([SecureStore.deleteItemAsync(URL_KEY), SecureStore.deleteItemAsync(TOKEN_KEY)]);
}

let meta: CloudMeta | null = null;

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getMeta(): CloudMeta {
  if (meta) return meta;
  let loaded: Partial<CloudMeta> = {};
  try {
    const f = new File(internalDir(), META_FILE);
    if (f.exists) loaded = JSON.parse(f.textSync()) as Partial<CloudMeta>;
  } catch (e) {
    console.warn('[cloud] bad cloud.json', e);
  }
  meta = {
    deviceId: typeof loaded.deviceId === 'string' ? loaded.deviceId : newId(),
    deviceName:
      typeof loaded.deviceName === 'string' && loaded.deviceName
        ? loaded.deviceName
        : (Device.deviceName ?? Device.modelName ?? 'Phone'),
    lastSyncAt: typeof loaded.lastSyncAt === 'number' ? loaded.lastSyncAt : null,
    pendingDeletes: Array.isArray(loaded.pendingDeletes)
      ? loaded.pendingDeletes.filter((n): n is string => typeof n === 'string')
      : [],
  };
  if (!loaded.deviceId) saveMeta({});
  return meta;
}

export function saveMeta(patch: Partial<CloudMeta>) {
  meta = { ...getMeta(), ...patch };
  try {
    const f = new File(internalDir(), META_FILE);
    if (!f.exists) f.create();
    f.write(JSON.stringify(meta));
  } catch (e) {
    console.warn('[cloud] could not save cloud.json', e);
  }
}
