/**
 * Ride list. Landscape: list on the left, the selected ride's map, stats and
 * actions on the right. Portrait: list only; a tap opens the ride screen.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getCloudStatus, rideDeleted, subscribeCloud } from '@/cloud/sync';
import { RideMap, useRideData } from '@/components/ride-map';
import { RideStats } from '@/components/ride-stats';
import { ScreenHeader } from '@/components/screen-header';
import { Chip, PillButton, R } from '@/components/ui';
import { useObd, useRide } from '@/engine/hooks';
import { closeRide, currentRide } from '@/engine/ride';
import { fmtKmL, kmPerL } from '@/engine/units';
import { deleteRide, listRides, shareRide } from '@/storage/rideLog';
import type { RideSummary } from '@/storage/rideSummary';
import { C, fmt } from '@/theme/dash';

type Filter = 'all' | 'mine' | 'synced';

function when(r: RideSummary): string {
  if (!r.startedAt) return r.name;
  const d = new Date(r.startedAt);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return today ? `Today · ${time}` : `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · ${time}`;
}

function summary(r: RideSummary): string {
  const h = Math.floor(r.durationMin / 60);
  const m = Math.round(r.durationMin % 60);
  return `${h}h ${String(m).padStart(2, '0')}m · ${fmt(r.km, 1)} km · ${fmtKmL(kmPerL(r.km, r.fuelL))} km/L`;
}

export default function RidesScreen() {
  const { odometer } = useObd();
  const ride = useRide();
  const { width, height } = useWindowDimensions();
  const portrait = height > width;
  const [rides, setRides] = useState<RideSummary[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const refresh = useCallback(() => {
    const o = currentRide();
    setOpen(o);
    setRides(listRides(o));
  }, []);

  useFocusEffect(refresh);
  // Show rides a sync brought in from (or deleted on) another phone.
  useEffect(
    () =>
      subscribeCloud(() => {
        if (!getCloudStatus().syncing) refresh();
      }),
    [refresh],
  );

  const shown = rides.filter((r) => (filter === 'all' ? true : filter === 'synced' ? !!r.device : !r.device));
  const sel = shown.find((r) => r.name === selected) ?? shown[0] ?? null;
  const detail = useRideData(portrait ? null : sel?.name);

  function confirmEnd() {
    Alert.alert('End ride?', 'The ride is saved and a new one starts with the next bike data.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End ride',
        style: 'destructive',
        onPress: () => {
          closeRide();
          refresh();
        },
      },
    ]);
  }

  async function share(name: string) {
    try {
      await shareRide(name);
    } catch (e) {
      Alert.alert('Share failed', String(e));
    }
  }

  function confirmDelete(name: string) {
    Alert.alert('Delete ride?', `${name}\nThis removes it from the app, the storage folder and (with cloud sync on) your other phones.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteRide(name);
          rideDeleted(name); // and on the other phones
          refresh();
        },
      },
    ]);
  }

  const filterChip = (f: Filter, label: string) => (
    <Pressable key={f} onPress={() => setFilter(f)} accessibilityRole="button" accessibilityState={{ selected: filter === f }}>
      <View style={[styles.filter, filter === f && styles.filterOn]}>
        <Text style={[styles.filterTxt, filter === f && { color: C.fg }]}>{label}</Text>
      </View>
    </Pressable>
  );

  const item = ({ item: r }: { item: RideSummary }) => {
    const isOpen = r.name === open;
    const isSel = !portrait && r.name === sel?.name;
    return (
      <Pressable
        onPress={() =>
          portrait ? router.push({ pathname: '/ride/[name]', params: { name: r.name } }) : setSelected(r.name)
        }
        style={({ pressed }) => [styles.item, isSel && styles.itemOn, pressed && { opacity: 0.7 }]}>
        <View style={styles.itemHead}>
          <Text style={styles.itemTitle}>
            {when(r)}
            {r.mock ? ' · mock' : ''}
          </Text>
          {isOpen ? (
            <Chip dot={ride.pausedAt != null ? C.dim : C.danger} label={ride.pausedAt != null ? 'Paused' : 'Recording'} />
          ) : r.device ? (
            <Text style={styles.device}>from {r.device}</Text>
          ) : null}
        </View>
        <Text style={styles.itemSub}>{summary(r)}</Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.page} edges={['left', 'right', 'top', 'bottom']}>
      <ScreenHeader title="Rides">
        <Chip
          label="Lifetime"
          value={`${fmt(odometer.kmTotal, 0)} km · ${fmtKmL(odometer.kmPerL)} km/L`}
        />
        {portrait ? null : (
          <View style={styles.filters}>
            {filterChip('all', 'All')}
            {filterChip('mine', 'This phone')}
            {filterChip('synced', 'Synced')}
          </View>
        )}
      </ScreenHeader>

      <View style={styles.body}>
        <FlatList
          style={portrait ? { flex: 1 } : { width: 316, flexGrow: 0 }}
          contentContainerStyle={{ gap: 8 }}
          data={shown}
          keyExtractor={(r) => r.name}
          renderItem={item}
          ListEmptyComponent={<Text style={styles.empty}>No rides recorded yet.</Text>}
        />

        {!portrait && sel ? (
          <View style={styles.detail}>
            <View style={styles.mapBox}>
              {/* Preview only: the metric switch and legend live on the full map. */}
              {detail ? <RideMap ride={detail} metric="speed" padding={28} /> : null}
              <View style={styles.mapBottom} pointerEvents="box-none">
                <PillButton
                  icon="expand"
                  label="Full map"
                  strong
                  onPress={() => router.push({ pathname: '/ride/[name]', params: { name: sel.name } })}
                  style={{ backgroundColor: C.bg, height: 34 }}
                />
              </View>
            </View>
            {detail ? <RideStats stats={detail.stats} columns={3} /> : null}
            <View style={styles.actions}>
              {detail?.bounds ? (
                <PillButton
                  icon="backToStart"
                  label="Back to start"
                  strong
                  onPress={() => router.push({ pathname: '/trackback', params: { ride: sel.name } })}
                />
              ) : null}
              <PillButton icon="share" label="Share CSV" onPress={() => void share(sel.name)} />
              {sel.name === open ? (
                <PillButton label="End ride" onPress={confirmEnd} />
              ) : (
                <PillButton label="Delete" color={C.danger} onPress={() => confirmDelete(sel.name)} style={{ marginLeft: 'auto' }} />
              )}
            </View>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 20, paddingVertical: 12, gap: 10 },
  body: { flex: 1, flexDirection: 'row', gap: 10, minHeight: 0 },
  filters: { marginLeft: 'auto', flexDirection: 'row', gap: 6 },
  filter: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.line,
    justifyContent: 'center',
  },
  filterOn: { borderColor: C.outline },
  filterTxt: { color: C.muted, fontSize: 13 },
  item: {
    backgroundColor: C.panel,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: R.tile,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 4,
  },
  itemOn: { borderColor: C.muted },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'space-between' },
  itemTitle: { color: C.fg, fontSize: 14, fontWeight: '500', flexShrink: 1 },
  itemSub: { color: C.muted, fontSize: 13, fontVariant: ['tabular-nums'] },
  device: { color: C.muted, fontSize: 11 },
  empty: { color: C.muted, fontSize: 15, textAlign: 'center', marginTop: 40 },
  detail: { flex: 1, gap: 8, minWidth: 0 },
  mapBox: {
    flex: 1,
    borderRadius: R.card,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.panel,
    overflow: 'hidden',
  },
  mapBottom: { position: 'absolute', right: 10, bottom: 10 },
  actions: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
});
