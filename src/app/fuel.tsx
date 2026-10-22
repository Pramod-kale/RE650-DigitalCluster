/**
 * Fuel: add a refuel and see the log in one place. Landscape: form left, log
 * right. Portrait: form, then the log.
 */
import { router } from 'expo-router';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RefuelForm } from '@/components/refuel-form';
import { ScreenHeader } from '@/components/screen-header';
import { Chip, Hatch, PillButton, R } from '@/components/ui';
import { useFuel, useRuntime } from '@/engine/hooks';
import { updateSettings } from '@/engine/runtime';
import { fmtKmL } from '@/engine/units';
import type { EntryResult } from '@/fuel/fuelMath';
import { C, fmt } from '@/theme/dash';

const BADGE: Record<NonNullable<EntryResult['reason']>, string> = {
  first: 'First fill',
  partial: 'Partial',
  missed: 'Missed fill',
};

export default function FuelScreen() {
  const fuel = useFuel();
  const { settings } = useRuntime();
  const { width, height } = useWindowDimensions();
  const portrait = height > width;

  const suggested = fuel.suggestedFactor;
  // Only suggest when it's a meaningful change (>3%).
  const showCal =
    suggested != null && Math.abs(suggested - settings.fuelCorrection) / settings.fuelCorrection > 0.03;

  function applyFactor() {
    if (suggested == null) return;
    Alert.alert(
      'Update fuel calibration?',
      `${settings.fuelCorrection} → ${suggested}\nLive km/L and the fuel used since the last refuel are recalculated with the new value.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Apply', onPress: () => updateSettings({ fuelCorrection: suggested }) },
      ],
    );
  }

  const cal = showCal ? (
    <View style={styles.cal}>
      <Hatch color={C.panel} gap={8} />
      <Text style={styles.calTxt}>
        Pump data suggests calibration <Text style={{ color: C.info }}>{suggested}</Text> (now {settings.fuelCorrection}) ·{' '}
        {fuel.validTanks} full tank{fuel.validTanks === 1 ? '' : 's'}
      </Text>
      <PillButton label="Apply" strong onPress={applyFactor} style={{ height: 32 }} />
    </View>
  ) : null;

  const entry = ({ item }: { item: EntryResult }) => (
    <Pressable
      onPress={() => router.push({ pathname: '/refuel', params: { id: item.entry.id } })}
      style={({ pressed }) => [styles.item, pressed && { opacity: 0.7 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.itemHead}>
          <Text style={styles.itemTitle}>
            {new Date(item.entry.t).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}
          </Text>
          <Text style={styles.itemSub}>
            {fmt(item.entry.litres, 2)} L{item.entry.cost != null ? ` · ${fmt(item.entry.cost, 0)}` : ''}
          </Text>
          {item.reason ? (
            <View style={styles.badge}>
              <Text style={styles.badgeTxt}>{BADGE[item.reason]}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.itemKm}>
          {fmt(item.entry.km, 1)} km since previous
          {item.entry.note ? ` · ${item.entry.note}` : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.kml}>{fmtKmL(item.kmPerL)}</Text>
        <Text style={styles.kmlUnit}>km/L</Text>
      </View>
    </Pressable>
  );

  const form = <RefuelForm onDone={() => undefined} />;

  return (
    <SafeAreaView style={styles.page} edges={['left', 'right', 'top', 'bottom']}>
      <ScreenHeader title="Fuel">
        <Chip label="Avg" value={`${fmtKmL(fuel.lifetimeKmPerL)} km/L`} />
        {portrait ? null : (
          <>
            <Chip label="Last tank" value={`${fmtKmL(fuel.lastKmPerL)} km/L`} />
            <Chip label="Bought" value={`${fmt(fuel.totalLitres, 0)} L`} />
            {fuel.totalCost ? <Chip label="Spent" value={fmt(fuel.totalCost, 0)} /> : null}
          </>
        )}
      </ScreenHeader>

      {portrait ? (
        <FlatList
          data={fuel.results}
          keyExtractor={(r) => r.entry.id}
          renderItem={entry}
          contentContainerStyle={{ gap: 6, paddingBottom: 24 }}
          ListHeaderComponent={
            <View style={{ gap: 8, marginBottom: 4 }}>
              {form}
              {cal}
            </View>
          }
          ListEmptyComponent={<Text style={styles.empty}>No refuels yet.</Text>}
        />
      ) : (
        <View style={styles.body}>
          <ScrollView style={{ width: 340, flexGrow: 0 }} keyboardShouldPersistTaps="handled">
            {form}
          </ScrollView>
          <View style={{ flex: 1, gap: 8, minWidth: 0 }}>
            {cal}
            <FlatList
              data={fuel.results}
              keyExtractor={(r) => r.entry.id}
              renderItem={entry}
              contentContainerStyle={{ gap: 6 }}
              ListEmptyComponent={<Text style={styles.empty}>No refuels yet. Log one on the left each time you fill up.</Text>}
            />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 20, paddingVertical: 12, gap: 10 },
  body: { flex: 1, flexDirection: 'row', gap: 10, minHeight: 0 },
  cal: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    overflow: 'hidden',
  },
  calTxt: { flex: 1, color: C.muted, fontSize: 13 },
  item: {
    backgroundColor: C.panel,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: R.tile - 2,
    paddingVertical: 8,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  itemTitle: { color: C.fg, fontSize: 14, fontWeight: '500' },
  itemSub: { color: C.muted, fontSize: 13, fontVariant: ['tabular-nums'] },
  itemKm: { color: C.dim, fontSize: 12 },
  badge: { height: 20, paddingHorizontal: 8, borderRadius: 999, borderWidth: 1, borderStyle: 'dashed', borderColor: C.warn, justifyContent: 'center' },
  badgeTxt: { color: C.warn, fontSize: 11 },
  kml: { color: C.fg, fontSize: 20, fontVariant: ['tabular-nums'] },
  kmlUnit: { color: C.dim, fontSize: 11 },
  empty: { color: C.muted, fontSize: 14, textAlign: 'center', marginTop: 30 },
});
