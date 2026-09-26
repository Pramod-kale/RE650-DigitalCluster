import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { useObd } from '@/engine/hooks';
import { currentRide } from '@/engine/ride';
import { fmtKmL, kmPerL } from '@/engine/units';
import { deleteRide, listRides, shareRide } from '@/storage/rideLog';
import type { RideSummary } from '@/storage/rideSummary';
import { C, fmt } from '@/theme/dash';

export default function RidesScreen() {
  const { odometer } = useObd();
  const [rides, setRides] = useState<RideSummary[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const o = currentRide();
    setOpen(o);
    setRides(listRides(o));
  }, []);

  useFocusEffect(refresh);

  async function share(name: string) {
    try {
      await shareRide(name);
    } catch (e) {
      Alert.alert('Share failed', String(e));
    }
  }

  function confirmDelete(name: string) {
    Alert.alert('Delete ride?', `${name}\nThis removes it from the app and from the storage folder.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteRide(name);
          refresh();
        },
      },
    ]);
  }

  return (
    <FlatList
      style={{ backgroundColor: C.bg }}
      contentContainerStyle={styles.page}
      data={rides}
      keyExtractor={(r) => r.name}
      ListHeaderComponent={
        <View style={styles.odo}>
          <Text style={styles.micro}>LIFETIME</Text>
          <Text style={styles.odoTxt}>
            <Text style={styles.b}>{fmt(odometer.kmTotal, 1)}</Text> km ·{' '}
            <Text style={styles.b}>{fmt(odometer.fuelTotalL, 2)}</Text> L · avg{' '}
            <Text style={styles.b}>{fmtKmL(odometer.kmPerL)}</Text> km/L
          </Text>
        </View>
      }
      ListEmptyComponent={<Text style={styles.empty}>No rides recorded yet.</Text>}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.title}>
              {item.startedAt ? new Date(item.startedAt).toLocaleString() : item.name}
              {item.mock ? '  · MOCK' : ''}
              {item.name === open ? '  · RECORDING' : ''}
            </Text>
            <Text style={styles.sub}>
              {fmt(item.durationMin, 0)} min · {fmt(item.km, 1)} km · {fmt(item.fuelL, 2)} L · avg{' '}
              {fmtKmL(kmPerL(item.km, item.fuelL))} km/L · Vmax {fmt(item.vMax, 0)} · RPM max{' '}
              {fmt(item.rpmMax, 0)}
            </Text>
            <Text style={styles.file}>{item.name}</Text>
          </View>
          <Pressable style={styles.btn} onPress={() => share(item.name)}>
            <Text style={styles.btnTxt}>Share</Text>
          </Pressable>
          {item.name !== open ? (
            <Pressable style={styles.btn} onPress={() => confirmDelete(item.name)}>
              <Text style={[styles.btnTxt, { color: C.danger }]}>Delete</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 10 },
  odo: { marginBottom: 6, gap: 2 },
  micro: { fontSize: 10, letterSpacing: 2, color: C.muted },
  odoTxt: { color: C.muted, fontSize: 15 },
  b: { color: C.fg, fontWeight: '700' },
  empty: { color: C.muted, textAlign: 'center', marginTop: 40 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.panel,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  title: { color: C.fg, fontSize: 15, fontWeight: '600' },
  sub: { color: C.muted, fontSize: 13 },
  file: { color: C.muted, fontSize: 11 },
  btn: {
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  btnTxt: { color: C.fg, fontSize: 13 },
});
