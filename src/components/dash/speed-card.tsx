import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Card, TickBar } from '@/components/ui';
import { RPM_MAX } from '@/obd/constants';
import { C, fmt, rpmColor, speedColor, ZONES } from '@/theme/dash';

const RPM_STEP = 250;

/** Speed number + gear box + segmented RPM bar. */
export function SpeedCard({
  speed,
  rpm,
  gear,
  big,
  style,
}: {
  speed: number;
  rpm: number;
  gear: number | null;
  big: number; // speed font size
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Card style={[styles.card, style]}>
      <View style={styles.row}>
        <Text style={styles.label}>Speed</Text>
        <Text style={styles.label}>km/h</Text>
      </View>
      <View style={styles.main}>
        <Text
          style={[styles.speed, { fontSize: big, lineHeight: big * 0.95, color: speedColor(speed) }]}
          numberOfLines={1}
          adjustsFontSizeToFit>
          {fmt(speed, 0, '0')}
        </Text>
        <View style={[styles.gear, { width: big * 0.55, height: big * 0.66 }]}>
          <Text style={[styles.gearNum, { fontSize: big * 0.33 }]}>{gear ?? '–'}</Text>
          <Text style={styles.gearLabel}>Gear</Text>
        </View>
      </View>
      <View style={[styles.row, { marginBottom: 6 }]}>
        <Text style={styles.label}>RPM</Text>
        <Text style={[styles.rpm, { color: rpmColor(rpm) }]}>{Math.round(rpm).toLocaleString('en-US')}</Text>
      </View>
      <TickBar value={rpm} max={RPM_MAX} step={RPM_STEP} warn={ZONES.rpm.warn} danger={ZONES.rpm.danger} />
      <View style={[styles.row, { marginTop: 4 }]}>
        <Text style={styles.scale}>0</Text>
        <Text style={styles.scale}>4k</Text>
        <Text style={styles.scale}>5.5k</Text>
        <Text style={styles.scale}>7k redline</Text>
        <Text style={styles.scale}>8.5k</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: 12, paddingHorizontal: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  label: { color: C.muted, fontSize: 13 },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 0 },
  speed: {
    flex: 1,
    fontWeight: '300',
    letterSpacing: -4,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  gear: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearNum: { color: C.fg, fontWeight: '400', includeFontPadding: false },
  gearLabel: { color: C.muted, fontSize: 11 },
  rpm: { fontSize: 14, fontVariant: ['tabular-nums'] },
  scale: { color: C.dim, fontSize: 11 },
});
