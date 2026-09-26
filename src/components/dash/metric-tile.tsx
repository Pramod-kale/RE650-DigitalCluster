import { StyleSheet, Text, View } from 'react-native';

import { C, toneColor, type Tone } from '@/theme/dash';

type Props = { label: string; value: string; unit?: string; tone?: Tone };

/** Small label/value tile for the secondary strip. */
export function MetricTile({ label, value, unit, tone = 'plain' }: Props) {
  return (
    <View style={[styles.tile, tone === 'accent' && { borderColor: C.info }]}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.value, { color: toneColor[tone] }]} numberOfLines={1}>
        {value}
        {unit ? <Text style={styles.unit}>{unit}</Text> : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    backgroundColor: C.panel,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 4,
  },
  label: { fontSize: 10, color: C.muted, letterSpacing: 1.5, flexShrink: 1 },
  value: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  unit: { fontSize: 11, fontWeight: '400', color: C.muted },
});
