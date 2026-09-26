import { useState } from 'react';
import { Alert, ScrollView, Switch, Text, View } from 'react-native';

import { Button, Field, formStyles, Row, Section } from '@/components/form';
import { useObd, useRuntime } from '@/engine/hooks';
import { chooseFolder, getRuntime, resetSession, updateSettings } from '@/engine/runtime';
import { fmtKmL } from '@/engine/units';
import { DEFAULT_SETTINGS } from '@/settings/settings';
import { C, fmt } from '@/theme/dash';

type Form = { host: string; port: string; ve: string; fuelCorrection: string; pollIntervalMs: string };

export default function SettingsScreen() {
  const { settings, folderUri, storageError } = useRuntime();
  const { odometer, session } = useObd();
  const [form, setForm] = useState<Form>(() => toForm(settings));

  const set = (k: keyof Form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  function save() {
    const parsed = {
      host: form.host.trim(),
      port: Number(form.port),
      ve: Number(form.ve),
      fuelCorrection: Number(form.fuelCorrection),
      pollIntervalMs: Number(form.pollIntervalMs),
    };
    updateSettings(parsed);
    // updateSettings drops invalid values; show what was actually kept.
    setForm(toForm(getRuntime().settings));
    Alert.alert('Saved', 'The connection restarts with the new settings.');
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Section title="DONGLE">
        <Field label="Host (ELM327 IP)" value={form.host} onChange={set('host')} keyboard="numbers-and-punctuation" />
        <Field label="Port" value={form.port} onChange={set('port')} keyboard="number-pad" />
        <Field label="Poll interval (ms)" value={form.pollIntervalMs} onChange={set('pollIntervalMs')} keyboard="number-pad" />
        <Row label="Mock data (no bike)">
          <Switch value={settings.mock} onValueChange={(mock) => updateSettings({ mock })} />
        </Row>
      </Section>

      <Section title="FUEL MODEL">
        <Field label="Volumetric efficiency (VE)" value={form.ve} onChange={set('ve')} keyboard="decimal-pad" />
        <Field
          label="Fuel correction factor"
          value={form.fuelCorrection}
          onChange={set('fuelCorrection')}
          keyboard="decimal-pad"
        />
        <Text style={styles.hint}>
          After a few full-to-full refuels, the Fuel log suggests a calibrated factor. Defaults: VE{' '}
          {DEFAULT_SETTINGS.ve}, factor {DEFAULT_SETTINGS.fuelCorrection}.
        </Text>
      </Section>

      <View style={styles.buttons}>
        <Button label="Save" onPress={save} primary />
        <Button label="Defaults" onPress={() => setForm(toForm(DEFAULT_SETTINGS))} />
      </View>

      <Section title="STORAGE">
        <Text style={styles.value} selectable>
          {folderUri ? decodeURIComponent(folderUri) : 'No folder picked — data is lost on reinstall / clear data'}
        </Text>
        {storageError ? <Text style={[styles.hint, { color: C.warn }]}>{storageError}</Text> : null}
        <Text style={styles.hint}>
          Rides (CSV), odometer and tank are kept in the app and mirrored to this folder. After a
          reinstall, pick the same folder to restore everything.
        </Text>
        <View style={styles.buttons}>
          <Button label={folderUri ? 'Change folder' : 'Pick folder'} onPress={chooseFolder} />
        </View>
      </Section>

      <Section title="ODOMETER (LIFETIME)">
        <Text style={styles.value}>
          {fmt(odometer.kmTotal, 1)} km · {fmt(odometer.fuelTotalL, 2)} L · avg{' '}
          {fmtKmL(odometer.kmPerL)} km/L · {fmt(odometer.daysActive, 1)} days
        </Text>
      </Section>

      <Section title="SESSION">
        <Text style={styles.value}>
          {fmt(session.elapsedMin, 0)} min · {fmt(session.kmTotal, 1)} km · Vmax {fmt(session.vMax, 0)} ·
          RPM max {fmt(session.rpmMax, 0)} · oil max {fmt(session.eotMax, 0)}°C
        </Text>
        <View style={styles.buttons}>
          <Button label="Reset session" onPress={resetSession} />
        </View>
      </Section>
    </ScrollView>
  );
}

function toForm(s: typeof DEFAULT_SETTINGS): Form {
  return {
    host: s.host,
    port: String(s.port),
    ve: String(s.ve),
    fuelCorrection: String(s.fuelCorrection),
    pollIntervalMs: String(s.pollIntervalMs),
  };
}

const styles = formStyles;
