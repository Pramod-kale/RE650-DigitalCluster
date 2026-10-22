/**
 * Bluetooth ELM327 (local ObdBluetooth module, Android only): Classic dongles
 * talk SPP and must be paired in Android settings first; BLE dongles are found
 * by scanning and need no pairing.
 */
import { requireOptionalNativeModule } from 'expo';
import { PermissionsAndroid, Platform } from 'react-native';

import { ConnectionError, type Transport, type TransportEvents } from './transport';

export type BtKind = 'classic' | 'ble';
export type BtDevice = { id: string; name: string; kind: BtKind };

type Events = {
  onData(e: { data: string }): void;
  onClose(e: { error: string | null }): void;
  onDevice(e: BtDevice & { rssi: number }): void;
};

type Subscription = { remove(): void };

type ObdBluetoothModule = {
  addListener<E extends keyof Events>(event: E, listener: Events[E]): Subscription;
  isEnabled(): boolean;
  bondedDevices(): BtDevice[];
  startScan(): void;
  stopScan(): void;
  connect(kind: BtKind, id: string): Promise<void>;
  write(data: string): Promise<void>;
  disconnect(): void;
}

const native = requireOptionalNativeModule<ObdBluetoothModule>('ObdBluetooth');

// RFCOMM connects to a dongle that is off can hang for ~12 s; give up a bit later.
const CONNECT_TIMEOUT_MS = 15_000;

export const bluetoothAvailable = native != null;

// Connection errors the dashboard turns into banners (the poller puts them in its status).
export const BT_OFF = 'Bluetooth is off';
export const BT_NO_PERMISSION = 'Bluetooth permission needed';

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Android 12+ has runtime Bluetooth permissions; older versions grant them at
// install, and BLE scanning there rides on the location permission gps.ts asks for.
function needed() {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 31) return [];
  return [PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT, PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN];
}

export async function hasBtPermission(): Promise<boolean> {
  for (const p of needed()) if (!(await PermissionsAndroid.check(p))) return false;
  return true;
}

/** Shows the "Nearby devices" prompt if needed. Call while the app is open. */
export async function requestBtPermission(): Promise<boolean> {
  const perms = needed();
  if (perms.length === 0) return true;
  try {
    const r = await PermissionsAndroid.requestMultiple(perms);
    return perms.every((p) => r[p] === PermissionsAndroid.RESULTS.GRANTED);
  } catch (e) {
    console.warn('[bt] permission request failed', e);
    return false;
  }
}

export function bluetoothOn(): boolean {
  try {
    return native?.isEnabled() ?? false;
  } catch {
    return false;
  }
}

/** Paired devices (throws with a readable message when Bluetooth is off). */
export function pairedDevices(): BtDevice[] {
  if (!native) throw new Error('Bluetooth is not available in this build');
  return native.bondedDevices();
}

/** Scan for BLE dongles; returns a stop function. Each device is reported once. */
export function scanBle(found: (d: BtDevice) => void): () => void {
  if (!native) throw new Error('Bluetooth is not available in this build');
  const seen = new Set<string>();
  const sub = native.addListener('onDevice', (d) => {
    if (seen.has(d.id)) return;
    seen.add(d.id);
    found({ id: d.id, name: d.name, kind: d.kind });
  });
  try {
    native.startScan();
  } catch (e) {
    sub.remove();
    throw e;
  }
  return () => {
    sub.remove();
    try {
      native.stopScan();
    } catch {
      // Bluetooth turned off meanwhile
    }
  };
}

export class BtTransport implements Transport {
  private subs: Subscription[] = [];

  constructor(private device: BtDevice) {}

  get label(): string {
    return `${this.device.name} (${this.device.kind === 'ble' ? 'BLE' : 'Bluetooth'})`;
  }

  async open(on: TransportEvents): Promise<void> {
    if (!native) throw new ConnectionError('Bluetooth is not available in this build');
    if (!(await hasBtPermission())) throw new ConnectionError(BT_NO_PERMISSION);
    if (!bluetoothOn()) throw new ConnectionError(BT_OFF);
    this.detach();
    this.subs = [
      native.addListener('onData', (e) => on.data(e.data)),
      native.addListener('onClose', () => {
        this.detach();
        on.close();
      }),
    ];
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        native.connect(this.device.kind, this.device.id),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timed out')), CONNECT_TIMEOUT_MS);
        }),
      ]);
    } catch (e) {
      this.close();
      throw new ConnectionError(errText(e));
    } finally {
      clearTimeout(timer);
    }
  }

  async write(text: string): Promise<void> {
    if (!native) throw new ConnectionError('Bluetooth is not available in this build');
    try {
      await native.write(text);
    } catch (e) {
      throw new ConnectionError(errText(e));
    }
  }

  close(): void {
    this.detach();
    try {
      native?.disconnect();
    } catch {
      // already gone
    }
  }

  private detach() {
    this.subs.forEach((s) => s.remove());
    this.subs = [];
  }
}
