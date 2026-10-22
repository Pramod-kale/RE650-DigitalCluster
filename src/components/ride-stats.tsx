import { StyleSheet, Text, View } from 'react-native';

import { fmtKmL, kmPerL } from '@/engine/units';
import type { rideStats } from '@/storage/rideTrack';
import { C, fmt } from '@/theme/dash';

import { fmtDur } from './ride-map';
import { R } from './ui';

type Stats = ReturnType<typeof rideStats>;

/** Ride numbers as small tiles; `all` adds the long tail (idle fuel, battery…). */
export function RideStats({ stats, columns, all }: { stats: Stats; columns: number; all?: boolean }) {
  const items: [string, string, string][] = [
    ['Distance', fmt(stats.km, 1), 'km'],
    ['Moving', fmtDur(stats.movingS), ''],
    ['Avg', fmt(stats.avgMovingKmh, 0), 'km/h'],
    ['Top', fmt(stats.vMax, 0), 'km/h'],
    ['Fuel', fmt(stats.fuelL, 2), 'L'],
    ['Economy', fmtKmL(kmPerL(stats.km, stats.fuelL)), 'km/L'],
  ];
  if (all) {
    items.push(
      ['Stopped', fmtDur(stats.stoppedS), ''],
      ['Idle fuel', fmt(stats.idleFuelL, 2), 'L'],
      ['Max RPM', fmt(stats.rpmMax, 0), ''],
      ['Max oil', fmt(stats.eotMax, 0), '°C'],
      ['Min battery', fmt(stats.voltMin, 1), 'V'],
    );
  }
  return (
    <View style={styles.grid}>
      {items.map(([label, value, unit]) => (
        <View key={label} style={[styles.tile, { width: `${100 / columns - 2}%` }]}>
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
          <Text style={styles.value} numberOfLines={1}>
            {value}
            {unit ? <Text style={styles.unit}> {unit}</Text> : null}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tile: {
    flexGrow: 1,
    backgroundColor: C.panel,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: R.small,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  label: { color: C.muted, fontSize: 11 },
  value: { color: C.fg, fontSize: 16, fontVariant: ['tabular-nums'] },
  unit: { color: C.dim, fontSize: 11 },
});
