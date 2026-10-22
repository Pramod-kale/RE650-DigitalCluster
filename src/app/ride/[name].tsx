/** One ride on a large map: colour by metric, stats and actions beside (or below) it. */
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Legend, MetricChips, RideMap, useRideData } from '@/components/ride-map';
import { RideStats } from '@/components/ride-stats';
import { ScreenHeader } from '@/components/screen-header';
import { PillButton, R } from '@/components/ui';
import { parseRideName } from '@/storage/rideSummary';
import type { Metric } from '@/storage/rideTrack';
import { C } from '@/theme/dash';

export default function RideScreen() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const [metric, setMetric] = useState<Metric>('speed');
  const { width, height } = useWindowDimensions();
  const portrait = height > width;
  const ride = useRideData(name);

  const meta = name ? parseRideName(name) : null;
  const title = meta?.startedAt ? new Date(meta.startedAt).toLocaleString() : (name ?? 'Ride');

  return (
    <SafeAreaView style={styles.page} edges={['left', 'right', 'top', 'bottom']}>
      <ScreenHeader title={`${title}${meta?.mock ? ' · mock' : ''}`} />
      {!ride ? (
        <Text style={styles.muted}>This ride could not be found.</Text>
      ) : (
        <View style={[styles.body, portrait && { flexDirection: 'column' }]}>
          <View style={styles.mapBox}>
            <RideMap ride={ride} metric={metric} padding={60} />
            <View style={styles.top} pointerEvents="box-none">
              <MetricChips metric={metric} onChange={setMetric} />
            </View>
            <View style={styles.bottom} pointerEvents="box-none">
              <Legend metric={metric} />
            </View>
          </View>
          <ScrollView
            style={portrait ? { maxHeight: '42%' } : { width: 300, flexGrow: 0 }}
            contentContainerStyle={{ gap: 10 }}>
            {ride.bounds && name ? (
              <PillButton
                icon="backToStart"
                label="Back to start"
                strong
                onPress={() => router.push({ pathname: '/trackback', params: { ride: name } })}
              />
            ) : null}
            <RideStats stats={ride.stats} columns={portrait ? 3 : 2} all />
          </ScrollView>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 20, paddingVertical: 12, gap: 10 },
  body: { flex: 1, flexDirection: 'row', gap: 10 },
  mapBox: {
    flex: 1,
    borderRadius: R.card,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.panel,
    overflow: 'hidden',
  },
  top: { position: 'absolute', left: 12, top: 12, right: 12 },
  bottom: { position: 'absolute', left: 12, bottom: 12, right: 12, alignItems: 'flex-start' },
  muted: { color: C.muted, fontSize: 15 },
});
