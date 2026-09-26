import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Switch, Text, View } from 'react-native';

import { Button, Field, formStyles as styles, Row, Section } from '@/components/form';
import { useObd } from '@/engine/hooks';
import { addRefuel, deleteRefuel, updateRefuel } from '@/engine/runtime';
import { fmtKmL, kmPerL } from '@/engine/units';
import { getEntries } from '@/fuel/fuelLog';
import { C, fmt } from '@/theme/dash';

/** Add a refuel (no params) or edit one (?id=…). */
export default function RefuelScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = id ? getEntries().find((e) => e.id === id && !e.deleted) : undefined;
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
    router.back();
  }

  function remove() {
    if (!existing) return;
    Alert.alert(
      'Delete refuel?',
      'Its distance is added to the next refuel, so no km are lost.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteRefuel(existing.id);
            router.back();
          },
        },
      ],
    );
  }

  if (id && !existing) {
    return (
      <View style={styles.page}>
        <Text style={styles.value}>This refuel no longer exists.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: existing ? 'Edit refuel' : 'Refuel' }} />

      <Section title={existing ? new Date(existing.t).toLocaleString().toUpperCase() : 'SINCE LAST REFUEL'}>
        <Text style={styles.value}>
          {fmt(km, 1)} km ridden · app estimate {fmt(estL, 2)} L ({fmtKmL(kmPerL(km, estL))} km/L)
        </Text>
      </Section>

      <Section title="AT THE PUMP">
        <Field
          label="Litres added"
          value={litres}
          onChange={setLitres}
          keyboard="decimal-pad"
          placeholder="e.g. 11.4"
        />
        <Field label="Total cost (optional)" value={cost} onChange={setCost} keyboard="decimal-pad" />
        <Row label="Filled to full">
          <Switch value={full} onValueChange={setFull} />
        </Row>
        <Row label="I missed logging a refuel before this one">
          <Switch value={missed} onValueChange={setMissed} />
        </Row>
        <Field label="Note" value={note} onChange={setNote} keyboard="default" placeholder="optional" />
        <Text style={styles.hint}>
          Mileage is worked out between two full fills. A partial fill adds its litres to the
          next full one. If you missed logging a refuel, that tank is left out of the averages.
        </Text>
      </Section>

      <View style={styles.buttons}>
        <Button label={existing ? 'Save changes' : 'Save refuel'} onPress={save} primary />
        <Button label="Cancel" onPress={() => router.back()} />
        {existing ? <Button label="Delete" onPress={remove} danger /> : null}
      </View>
      {!existing ? (
        <Text style={[styles.hint, { color: C.muted }]}>
          Saving resets the since-refuel counters on the dashboard.
        </Text>
      ) : null}
    </ScrollView>
  );
}
