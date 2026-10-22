/** Add a refuel, or edit one (`existing`). Used by the Fuel screen and /refuel?id=… */
import { useState } from 'react';
import { Alert, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { useObd } from '@/engine/hooks';
import { addRefuel, deleteRefuel, updateRefuel } from '@/engine/runtime';
import { fmtKmL, kmPerL } from '@/engine/units';
import type { FuelEntry } from '@/fuel/fuelMath';
import { C, fmt } from '@/theme/dash';

import { PillButton, R } from './ui';

export function RefuelForm({ existing, onDone }: { existing?: FuelEntry; onDone: () => void }) {
  const { tank } = useObd();
  const [litres, setLitres] = useState(existing ? String(existing.litres) : '');
  const [cost, setCost] = useState(existing?.cost != null ? String(existing.cost) : '');
  const [full, setFull] = useState(existing ? !existing.partial : true);
  const [missed, setMissed] = useState(existing?.missedBefore ?? false);
  const [note, setNote] = useState(existing?.note ?? '');

  // Distance/estimate for this fill: live counters when adding, stored ones when editing.
  const km = existing ? existing.km : tank.sinceFillKm;
  const estL = existing ? existing.estL : tank.sinceFillL;

  function save() {
    const l = Number(litres.replace(',', '.'));
    if (!Number.isFinite(l) || l <= 0 || l > 50) {
      Alert.alert('Litres needed', 'Enter the litres added at the pump (0–50).');
      return;
    }
    const c = cost.trim() ? Number(cost.replace(',', '.')) : null;
    if (c != null && (!Number.isFinite(c) || c < 0)) {
      Alert.alert('Invalid cost', 'Leave it empty or enter the total amount paid.');
      return;
    }
    const input = { litres: l, cost: c, partial: !full, missedBefore: missed, note: note.trim() };
    if (existing) updateRefuel(existing.id, input);
    else addRefuel(input);
    setLitres('');
    setCost('');
    setFull(true);
    setMissed(false);
    setNote('');
    onDone();
  }

  function remove() {
    if (!existing) return;
    Alert.alert('Delete refuel?', 'Its distance is added to the next refuel, so no km are lost.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteRefuel(existing.id);
          onDone();
        },
      },
    ]);
  }

  const big = (label: string, value: string, set: (v: string) => void, placeholder: string, strong?: boolean) => (
    <View style={[styles.bigBox, strong && { borderColor: C.outline }]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.bigInput}
        value={value}
        onChangeText={set}
        keyboardType="decimal-pad"
        placeholder={placeholder}
        placeholderTextColor={C.line}
      />
    </View>
  );

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>{existing ? new Date(existing.t).toLocaleString() : 'Add refuel'}</Text>
        <Text style={styles.label}>
          {existing ? 'ridden' : 'since last'}:{' '}
          <Text style={{ color: C.fg }}>
            {fmt(km, 1)} km · est. {fmt(estL, 2)} L ({fmtKmL(kmPerL(km, estL))} km/L)
          </Text>
        </Text>
      </View>
      <View style={styles.bigRow}>
        {big('Litres added', litres, setLitres, '0.00', true)}
        {big('Cost (optional)', cost, setCost, '—')}
      </View>
      <View>
        <View style={[styles.row, styles.rowLine]}>
          <Text style={styles.rowTxt}>Filled to the top</Text>
          <Switch value={full} onValueChange={setFull} />
        </View>
        <View style={[styles.row, styles.rowLine]}>
          <Text style={styles.rowTxt}>Missed logging a refuel before this</Text>
          <Switch value={missed} onValueChange={setMissed} />
        </View>
        <View style={styles.row}>
          <TextInput
            style={styles.note}
            value={note}
            onChangeText={setNote}
            placeholder="Note (optional)"
            placeholderTextColor={C.dim}
          />
        </View>
      </View>
      <View style={styles.actions}>
        <PillButton label={existing ? 'Save changes' : 'Save refuel'} strong onPress={save} style={styles.save} />
        {existing ? <PillButton label="Delete" color={C.danger} onPress={remove} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.panel,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: R.card,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 10,
  },
  head: { gap: 2 },
  title: { color: C.fg, fontSize: 15, fontWeight: '500' },
  label: { color: C.muted, fontSize: 12 },
  bigRow: { flexDirection: 'row', gap: 8 },
  bigBox: { flex: 1, borderRadius: 14, borderWidth: 1, borderColor: C.line, paddingVertical: 6, paddingHorizontal: 12 },
  bigInput: { color: C.fg, fontSize: 28, fontWeight: '300', padding: 0, fontVariant: ['tabular-nums'] },
  row: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: C.border },
  rowTxt: { color: C.muted, fontSize: 13, flexShrink: 1 },
  note: { flex: 1, color: C.fg, fontSize: 13, paddingVertical: 6 },
  actions: { flexDirection: 'row', gap: 8 },
  save: { flex: 1, height: 46 },
});
