import { Link, router } from 'expo-router';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/form';
import { useFuel, useRuntime } from '@/engine/hooks';
import { updateSettings } from '@/engine/runtime';
import { fmtKmL } from '@/engine/units';
import type { EntryResult } from '@/fuel/fuelMath';
import { C, fmt } from '@/theme/dash';

const REASON: Record<NonNullable<EntryResult['reason']>, string> = {
  first: 'FIRST FILL · starting point',
  partial: 'PARTIAL · counted in next full fill',
  missed: 'MISSED FILL · excluded from average',
};

export default function FuelLogScreen() {
  const fuel = useFuel();
  const { settings } = useRuntime();

  const suggested = fuel.suggestedFactor;
  // Only suggest when it's a meaningful change (>3%).
  const showCal =
    suggested != null && Math.abs(suggested - settings.fuelCorrection) / settings.fuelCorrection > 0.03;

  function applyFactor() {
    if (suggested == null) return;
    Alert.alert(
      'Update fuel correction?',
      `${settings.fuelCorrection} → ${suggested}\nLive km/L and estimates will use the new factor from now on.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Apply', onPress: () => updateSettings({ fuelCorrection: suggested }) },
      ],
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: C.bg }}
      contentContainerStyle={styles.page}
      data={fuel.results}
      keyExtractor={(r) => r.entry.id}
      ListHeaderComponent={
        <View style={{ gap: 10 }}>
          <View style={styles.stats}>
            <Stat label="AVG MILEAGE" value={`${fmtKmL(fuel.lifetimeKmPerL)}`} unit="km/L" big />
            <Stat label="LAST TANK" value={fmtKmL(fuel.lastKmPerL)} unit="km/L" />
            <Stat label="FUEL BOUGHT" value={fmt(fuel.totalLitres, 1)} unit="L" />
            <Stat label="SPENT" value={fmt(fuel.totalCost, 0)} />
            <Stat label="TANKS MEASURED" value={String(fuel.validTanks)} />
          </View>
          {showCal ? (
            <View style={styles.cal}>
              <Text style={styles.calTxt}>
                Pump data says the app&apos;s fuel estimate should use a correction factor of{' '}
                <Text style={styles.b}>{suggested}</Text> (now {settings.fuelCorrection}), based on{' '}
                {fuel.validTanks} full tank{fuel.validTanks === 1 ? '' : 's'}.
              </Text>
              <Button label="Apply" onPress={applyFactor} primary />
            </View>
          ) : null}
          <View style={styles.headerRow}>
            <Text style={styles.micro}>HISTORY</Text>
            <Button label="⛽ Add refuel" onPress={() => router.push('/refuel')} />
          </View>
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.empty}>
          No refuels yet. Tap “⛽ Refuel” on the dashboard each time you fill up.
        </Text>
      }
      renderItem={({ item }) => (
        <Link href={{ pathname: '/refuel', params: { id: item.entry.id } }} asChild>
          <Pressable style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.title}>
                {new Date(item.entry.t).toLocaleString()}
                {'  ·  '}
                {fmt(item.entry.litres, 2)} L
                {item.entry.cost != null ? `  ·  ${fmt(item.entry.cost, 0)}` : ''}
              </Text>
              <Text style={styles.sub}>
                {fmt(item.entry.km, 1)} km since previous refuel
                {item.reason === null && item.segmentKm !== item.entry.km
                  ? ` · ${fmt(item.segmentKm, 1)} km / ${fmt(item.segmentL, 2)} L since last full`
                  : ''}
              </Text>
              {item.reason ? <Text style={styles.badge}>{REASON[item.reason]}</Text> : null}
              {item.entry.note ? <Text style={styles.note}>{item.entry.note}</Text> : null}
            </View>
            <View style={styles.mileage}>
              <Text style={[styles.mileageNum, item.kmPerL == null && { color: C.muted }]}>
                {fmtKmL(item.kmPerL)}
              </Text>
              <Text style={styles.unit}>km/L</Text>
            </View>
          </Pressable>
        </Link>
      )}
    />
  );
}

function Stat({ label, value, unit, big }: { label: string; value: string; unit?: string; big?: boolean }) {
  return (
    <View style={[styles.stat, big && { borderColor: C.info }]}>
      <Text style={styles.micro}>{label}</Text>
      <Text style={[styles.statNum, big && { color: C.info }]}>
        {value}
        {unit ? <Text style={styles.unit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 10 },
  stats: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  stat: {
    flexGrow: 1,
    backgroundColor: C.panel,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    gap: 2,
  },
  statNum: { color: C.fg, fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  micro: { fontSize: 10, letterSpacing: 2, color: C.muted },
  unit: { fontSize: 12, fontWeight: '400', color: C.muted },
  cal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderColor: C.info,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    backgroundColor: C.panel,
  },
  calTxt: { flex: 1, color: C.muted, fontSize: 13 },
  b: { color: C.fg, fontWeight: '700' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  empty: { color: C.muted, textAlign: 'center', marginTop: 30 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.panel,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  title: { color: C.fg, fontSize: 15, fontWeight: '600' },
  sub: { color: C.muted, fontSize: 13 },
  badge: { color: C.warn, fontSize: 11, letterSpacing: 1 },
  note: { color: C.muted, fontSize: 12, fontStyle: 'italic' },
  mileage: { alignItems: 'flex-end', minWidth: 70 },
  mileageNum: { color: C.info, fontSize: 26, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
