/** Choose the Bluetooth OBD dongle: paired (Classic or BLE) devices, or a BLE scan. */
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  bluetoothAvailable,
  pairedDevices,
  requestBtPermission,
  scanBle,
  type BtDevice,
} from '@/obd/bluetooth';
import { C, F } from '@/theme/dash';

import { Button, formStyles } from './form';

const SCAN_MS = 12_000;

const kindLabel = (d: BtDevice) => (d.kind === 'ble' ? 'BLE' : 'Classic');

export function BluetoothPicker({
  device,
  onPick,
}: {
  device: BtDevice | null;
  onPick: (d: BtDevice) => void;
}) {
  const [list, setList] = useState<BtDevice[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  if (!bluetoothAvailable) {
    return (
      <Text style={formStyles.hint}>
        {Platform.OS === 'android'
          ? 'Bluetooth needs a new build of the app (this one was built without it).'
          : 'Bluetooth dongles are supported on Android only for now.'}
      </Text>
    );
  }

  async function allowed(): Promise<boolean> {
    if (await requestBtPermission()) return true;
    Alert.alert(
      'Nearby devices permission needed',
      'Allow "Nearby devices" so the app can connect to the OBD dongle.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open settings', onPress: () => void Linking.openSettings() },
      ],
    );
    return false;
  }

  function stopScan() {
    stopRef.current?.();
    stopRef.current = null;
    setScanning(false);
  }

  async function showPaired() {
    stopScan();
    if (!(await allowed())) return;
    try {
      setList(pairedDevices());
    } catch (e) {
      Alert.alert('Bluetooth', e instanceof Error ? e.message : String(e));
    }
  }

  async function scan() {
    stopScan();
    if (!(await allowed())) return;
    setList([]);
    try {
      const stop = scanBle((d) => setList((l) => [...(l ?? []), d]));
      const timer = setTimeout(stopScan, SCAN_MS);
      stopRef.current = () => {
        clearTimeout(timer);
        stop();
      };
      setScanning(true);
    } catch (e) {
      Alert.alert('Bluetooth', e instanceof Error ? e.message : String(e));
    }
  }

  function pick(d: BtDevice) {
    stopScan();
    setList(null);
    onPick(d);
  }

  return (
    <View style={styles.wrap}>
      <Text style={formStyles.value}>
        {device ? `${device.name} · ${kindLabel(device)} · ${device.id}` : 'No dongle chosen'}
      </Text>
      <View style={formStyles.buttons}>
        <Button label="Paired devices" onPress={() => void showPaired()} />
        <Button label={scanning ? 'Scanning…' : 'Scan for BLE'} onPress={() => void scan()} />
        <Button
          label="Pair in Android"
          onPress={() =>
            void Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS').catch(() =>
              Linking.openSettings(),
            )
          }
        />
      </View>
      {list ? (
        list.length === 0 ? (
          <Text style={formStyles.hint}>{scanning ? 'Looking for BLE dongles…' : 'Nothing found.'}</Text>
        ) : (
          list.map((d) => (
            <Pressable
              key={d.id}
              onPress={() => pick(d)}
              style={({ pressed }) => [
                styles.item,
                d.id === device?.id && styles.itemOn,
                pressed && { opacity: 0.6 },
              ]}>
              <Text style={styles.itemName}>{d.name}</Text>
              <Text style={formStyles.hint}>
                {kindLabel(d)} · {d.id}
              </Text>
            </Pressable>
          ))
        )
      ) : null}
      <Text style={formStyles.hint}>
        Classic dongles (most ELM327 ones): pair them in Android Bluetooth settings first, usually
        with PIN 1234 or 0000, then pick them under Paired devices. BLE dongles (e.g. Vgate iCar Pro
        BLE, OBDLink CX) need no pairing: use Scan for BLE with the ignition on.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  item: {
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: C.bg,
  },
  itemOn: { borderColor: C.info },
  itemName: { color: C.fg, fontSize: F.body },
});
