/**
 * Settings, one section at a time: a section list on the left (a chip row on
 * top in portrait), the chosen section on the right. A dot marks a section
 * that needs attention.
 */
import { useEffect, useState } from 'react';
import { Alert, AppState, Pressable, ScrollView, StyleSheet, Switch, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { connect, disconnect, requestSync, setDeviceName } from '@/cloud/sync';
import { BluetoothPicker } from '@/components/bt-picker';
import { Button, Field, formStyles, Row, Section } from '@/components/form';
import { Icon, type IconName } from '@/components/icon';
import { ScreenHeader } from '@/components/screen-header';
import { R } from '@/components/ui';
import { keepAlive } from '@/engine/gps';
import { useCloud, useObd, useRuntime } from '@/engine/hooks';
import { chooseFolder, getRuntime, resetSession, updateSettings } from '@/engine/runtime';
import { fmtKmL } from '@/engine/units';
import { DEFAULT_SETTINGS } from '@/settings/settings';
import { C, fmt } from '@/theme/dash';

type Form = { host: string; port: string; fuelCorrection: string; pollIntervalMs: string };
type Key = 'connection' | 'background' | 'fuel' | 'cloud' | 'storage' | 'odometer';

const SECTIONS: { key: Key; label: string; icon: IconName }[] = [
  { key: 'connection', label: 'Connection', icon: 'bluetooth' },
  { key: 'background', label: 'Background', icon: 'pause' },
  { key: 'fuel', label: 'Fuel estimate', icon: 'fuel' },
  { key: 'cloud', label: 'Cloud sync', icon: 'share' },
  { key: 'storage', label: 'Storage', icon: 'map' },
  { key: 'odometer', label: 'Odometer & session', icon: 'route' },
];

function useBackgroundAllowed(): boolean {
  const read = () => keepAlive?.isIgnoringBatteryOptimizations() ?? true;
  const [ok, setOk] = useState(read);
  useEffect(() => {
    // The system dialog returns to the app: re-read when it does.
    const sub = AppState.addEventListener('change', (s) => s === 'active' && setOk(read()));
    return () => sub.remove();
  }, []);
  return ok;
}

export default function SettingsScreen() {
  const { settings, folderUri, storageError } = useRuntime();
  const { odometer, session, data, link } = useObd();
  const cloud = useCloud();
  const backgroundOk = useBackgroundAllowed();
  const { width, height } = useWindowDimensions();
  const portrait = height > width;
  const [tab, setTab] = useState<Key>('connection');
  const [form, setForm] = useState<Form>(() => toForm(settings));
  const [dbUrl, setDbUrl] = useState(cloud.url ?? '');
  const [dbToken, setDbToken] = useState('');
  const [device, setDevice] = useState(cloud.deviceName);
  const [busy, setBusy] = useState(false);

  const attention: Partial<Record<Key, boolean>> = {
    background: !backgroundOk,
    storage: !folderUri || !!storageError,
    cloud: !!cloud.lastError,
    connection: settings.transport === 'bluetooth' && !settings.btDevice,
  };

  async function saveCloud() {
    setBusy(true);
    const err = await connect(dbUrl, dbToken);
    setBusy(false);
    if (err) {
      Alert.alert('Could not connect', err);
      return;
    }
    setDbToken('');
    if (device.trim() && device.trim() !== cloud.deviceName) setDeviceName(device);
    Alert.alert('Connected', 'Sync is on. Rides, refuels and the odometer are shared with your other phones.');
  }

  function confirmDisconnect() {
    Alert.alert(
      'Turn off sync?',
      'Removes the database token from this phone. Your data stays on the phone and in the database.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Turn off', style: 'destructive', onPress: () => void disconnect() },
      ],
    );
  }

  const set = (k: keyof Form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  function save() {
    const parsed = {
      host: form.host.trim(),
      port: Number(form.port),
      fuelCorrection: Number(form.fuelCorrection),
      pollIntervalMs: Number(form.pollIntervalMs),
    };
    updateSettings(parsed);
    // updateSettings drops invalid values; show what was actually kept.
    setForm(toForm(getRuntime().settings));
    Alert.alert('Saved', 'The connection restarts with the new settings.');
  }

  const sections: Record<Key, React.ReactNode> = {
    connection: (
      <Section title="Dongle connection">
        <Row label="Connect over">
          <View style={styles.segment}>
            {(['wifi', 'bluetooth'] as const).map((t) => (
              <Pressable
                key={t}
                onPress={() => updateSettings({ transport: t })}
                accessibilityRole="button"
                accessibilityState={{ selected: settings.transport === t }}
                style={[styles.segItem, settings.transport === t && styles.segOn]}>
                <Text style={[styles.segTxt, settings.transport === t && { color: C.bright }]}>
                  {t === 'wifi' ? 'Wi-Fi' : 'Bluetooth'}
                </Text>
              </Pressable>
            ))}
          </View>
        </Row>
        <View style={styles.status}>
          <View style={[styles.dot, { backgroundColor: data.connected ? C.success : C.dim }]} />
          <Text style={formStyles.hint} numberOfLines={1}>
            {data.connected ? 'Connected' : link}
          </Text>
        </View>
        {settings.transport === 'wifi' ? (
          <>
            <Field label="Host (ELM327 IP)" value={form.host} onChange={set('host')} keyboard="numbers-and-punctuation" />
            <Field label="Port" value={form.port} onChange={set('port')} keyboard="number-pad" />
          </>
        ) : (
          <BluetoothPicker device={settings.btDevice} onPick={(btDevice) => updateSettings({ btDevice })} />
        )}
        <Field label="Poll interval (ms)" value={form.pollIntervalMs} onChange={set('pollIntervalMs')} keyboard="number-pad" />
        <Row label="Mock data (no bike)">
          <Switch value={settings.mock} onValueChange={(mock) => updateSettings({ mock })} />
        </Row>
        <View style={formStyles.buttons}>
          <Button label="Save" onPress={save} primary />
          <Button label="Defaults" onPress={() => setForm(toForm(DEFAULT_SETTINGS))} />
        </View>
      </Section>
    ),
    background: (
      <Section title="Background recording">
        <Text style={[formStyles.hint, !backgroundOk && { color: C.warn }]}>
          {!keepAlive
            ? 'Rides keep recording in the background on this phone.'
            : backgroundOk
              ? 'Unrestricted: rides keep recording with the screen off or another app open.'
              : 'Battery optimised: Android may pause recording during a stop with the screen off. Allow the app to run in the background.'}
        </Text>
        {keepAlive && !backgroundOk ? (
          <View style={formStyles.buttons}>
            <Button label="Allow background running" onPress={() => keepAlive?.requestIgnoreBatteryOptimizations()} primary />
          </View>
        ) : null}
      </Section>
    ),
    fuel: (
      <Section title="Fuel estimate">
        <Field label="Fuel calibration" value={form.fuelCorrection} onChange={set('fuelCorrection')} keyboard="decimal-pad" />
        <Text style={formStyles.hint}>
          The ECU doesn&apos;t report fuel flow, so it is estimated from RPM, manifold pressure and air
          temperature, then multiplied by this number. Leave it at {DEFAULT_SETTINGS.fuelCorrection} until
          you&apos;ve logged two full-tank refuels; the Fuel screen then suggests the right value from what
          the pump says.
        </Text>
        <View style={formStyles.buttons}>
          <Button label="Save" onPress={save} primary />
        </View>
      </Section>
    ),
    cloud: (
      <Section title="Cloud sync (Turso)">
        <Field label="Database URL" value={dbUrl} onChange={setDbUrl} keyboard="default" placeholder="libsql://name-you.turso.io" long />
        <Field
          label="Auth token"
          value={dbToken}
          onChange={setDbToken}
          keyboard="default"
          placeholder={cloud.configured ? 'saved — paste to replace' : 'paste token'}
          long
        />
        <Field label="This phone's name" value={device} onChange={setDevice} keyboard="default" />
        <Text style={[formStyles.hint, cloud.lastError ? { color: C.warn } : null]}>
          {!cloud.configured
            ? 'Off. Rides stay on this phone only.'
            : cloud.syncing
              ? 'Syncing…'
              : cloud.lastError
                ? `Last sync failed: ${cloud.lastError}`
                : cloud.lastSyncAt
                  ? `Synced ${new Date(cloud.lastSyncAt).toLocaleString()} · ${cloud.lastResult ?? ''}`
                  : 'Connected, not synced yet.'}
        </Text>
        <View style={formStyles.buttons}>
          <Button label={busy ? 'Connecting…' : cloud.configured ? 'Save' : 'Connect'} onPress={saveCloud} primary />
          {cloud.configured ? (
            <>
              <Button label="Sync now" onPress={() => void requestSync()} />
              <Button label="Turn off" onPress={confirmDisconnect} danger />
            </>
          ) : null}
        </View>
        <Text style={formStyles.hint}>
          Create a database for this app and a token with the Turso CLI, then paste both here on each
          phone:{'\n'}turso db create re650-cluster{'\n'}turso db show re650-cluster --url{'\n'}turso db
          tokens create re650-cluster --expiration never{'\n'}The token is kept in the phone&apos;s secure
          storage, never in the storage folder.
        </Text>
      </Section>
    ),
    storage: (
      <Section title="Storage folder">
        <Text style={formStyles.value} selectable>
          {folderUri ? decodeURIComponent(folderUri) : 'No folder picked — data is lost on reinstall / clear data'}
        </Text>
        {storageError ? <Text style={[formStyles.hint, { color: C.danger }]}>{storageError}</Text> : null}
        <Text style={formStyles.hint}>
          Rides (CSV), odometer and tank are kept in the app and mirrored to this folder. After a reinstall,
          pick the same folder to restore everything.
        </Text>
        <View style={formStyles.buttons}>
          <Button label={folderUri ? 'Change folder' : 'Pick folder'} onPress={chooseFolder} primary={!folderUri} />
        </View>
      </Section>
    ),
    odometer: (
      <Section title="Odometer & session">
        <Text style={formStyles.hint}>Lifetime</Text>
        <Text style={formStyles.value}>
          {fmt(odometer.kmTotal, 1)} km · {fmt(odometer.fuelTotalL, 2)} L · avg {fmtKmL(odometer.kmPerL)} km/L ·{' '}
          {fmt(odometer.daysActive, 1)} days
        </Text>
        <Text style={formStyles.hint}>This session</Text>
        <Text style={formStyles.value}>
          {fmt(session.elapsedMin, 0)} min · {fmt(session.kmTotal, 1)} km · Vmax {fmt(session.vMax, 0)} · RPM max{' '}
          {fmt(session.rpmMax, 0)} · oil max {fmt(session.eotMax, 0)}°C
        </Text>
        <View style={formStyles.buttons}>
          <Button label="Reset session" onPress={resetSession} />
        </View>
      </Section>
    ),
  };

  const nav = SECTIONS.map((s) => {
    const on = s.key === tab;
    return (
      <Pressable
        key={s.key}
        onPress={() => setTab(s.key)}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        style={[portrait ? styles.navChip : styles.navItem, on && styles.navOn]}>
        <Icon name={s.icon} size={17} color={on ? C.bright : C.muted} />
        <Text style={[styles.navTxt, on && { color: C.bright }]} numberOfLines={1}>
          {s.label}
        </Text>
        {attention[s.key] ? <View style={[styles.dot, { backgroundColor: C.warn, marginLeft: 'auto' }]} /> : null}
      </Pressable>
    );
  });

  return (
    <SafeAreaView style={styles.page} edges={['left', 'right', 'top', 'bottom']}>
      <ScreenHeader title="Settings" />
      <View style={[styles.body, portrait && { flexDirection: 'column' }]}>
        {portrait ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 6 }}>
            {nav}
          </ScrollView>
        ) : (
          <View style={styles.nav}>{nav}</View>
        )}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          {sections[tab]}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function toForm(s: typeof DEFAULT_SETTINGS): Form {
  return {
    host: s.host,
    port: String(s.port),
    fuelCorrection: String(s.fuelCorrection),
    pollIntervalMs: String(s.pollIntervalMs),
  };
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 20, paddingVertical: 12, gap: 10 },
  body: { flex: 1, flexDirection: 'row', gap: 10, minHeight: 0 },
  nav: { width: 220, gap: 4 },
  navItem: {
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  navChip: {
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navOn: { borderColor: C.outline, backgroundColor: C.panel },
  navTxt: { color: C.muted, fontSize: 14 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  segment: { flexDirection: 'row', padding: 3, borderRadius: 999, borderWidth: 1, borderColor: C.line },
  segItem: { height: 34, paddingHorizontal: 16, borderRadius: 999, justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  segOn: { borderColor: C.muted },
  segTxt: { color: C.muted, fontSize: 14 },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: R.tile - 2,
    borderWidth: 1,
    borderColor: C.line,
  },
});
