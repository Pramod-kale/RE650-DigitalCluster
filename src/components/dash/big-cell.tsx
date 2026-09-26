import { StyleSheet, Text, View } from 'react-native';

import { C } from '@/theme/dash';

type Props = {
  label: string;
  value: string;
  unit?: string;
  pct: number; // 0-100 bar fill
  ticks: [string, string, string];
  redlinePct?: number; // draws a red mark on the bar
  alert?: boolean; // redline highlight
  flex: number;
};

/** Big number + horizontal gauge (SPEED / RPM cells of App.vue). */
export function BigCell({ label, value, unit, pct, ticks, redlinePct, alert, flex }: Props) {
  return (
    <View style={[styles.cell, { flex }, alert && styles.alertCell]}>
      <Text style={styles.micro}>{label}</Text>
      <View style={styles.big}>
        <Text
          style={[styles.num, alert && { color: C.danger }]}
          numberOfLines={1}
          adjustsFontSizeToFit>
          {value}
        </Text>
        {unit ? <Text style={styles.unit}>{unit}</Text> : null}
      </View>
      <View style={styles.bar}>
        <View
          style={[
            styles.fill,
            { width: `${Math.max(0, Math.min(100, pct))}%` },
            { backgroundColor: redlinePct != null && pct >= redlinePct ? C.danger : C.info },
          ]}
        />
        {redlinePct != null ? <View style={[styles.redmark, { left: `${redlinePct}%` }]} /> : null}
      </View>
      <View style={styles.ticks}>
        {ticks.map((t) => (
          <Text key={t} style={styles.tick}>
            {t}
          </Text>
        ))}
      </View>
    </View>
  );
}

export const cellBase = {
  backgroundColor: C.panel,
  borderColor: C.border,
  borderWidth: 1,
  borderRadius: 8,
  paddingVertical: 8,
  paddingHorizontal: 12,
  justifyContent: 'center' as const,
};

const styles = StyleSheet.create({
  cell: cellBase,
  alertCell: { borderColor: C.danger },
  micro: { fontSize: 10, letterSpacing: 2, color: C.muted, marginBottom: 2 },
  big: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 6 },
  num: {
    flexShrink: 1,
    fontSize: 96,
    lineHeight: 100,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: -2,
    color: C.fg,
  },
  unit: { fontSize: 16, color: C.muted },
  bar: {
    height: 6,
    backgroundColor: C.barBg,
    borderRadius: 3,
    overflow: 'hidden',
    position: 'relative',
  },
  fill: { height: '100%' },
  redmark: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: C.danger },
  ticks: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  tick: { fontSize: 10, color: C.muted, fontVariant: ['tabular-nums'] },
});
