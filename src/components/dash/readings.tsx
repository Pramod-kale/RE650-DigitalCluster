import { StyleSheet, Text, View } from 'react-native';

import { HatchBar, R } from '@/components/ui';
import { C, fmt, pctZone } from '@/theme/dash';

/** Small label + value tile (oil, air, battery, economy). */
export function StatTile({
  label,
  value,
  unit,
  color,
  size = 'md',
}: {
  label: string;
  value: string;
  unit?: string;
  color?: string; // accent when the value is out of range
  size?: 'sm' | 'md';
}) {
  const sm = size === 'sm';
  return (
    <View style={[styles.tile, sm && styles.tileSm, color ? { borderColor: color } : null]}>
      <Text style={[styles.label, sm && { fontSize: 11 }, color ? { color } : null]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.value, { fontSize: sm ? 17 : 24 }, color ? { color } : null]} numberOfLines={1}>
        {value}
        {unit ? <Text style={styles.unit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

/** Throttle / load: percentage with a hatched bar that turns orange / red in its zones. */
export function PctTile({ label, value, vertical }: { label: string; value: number; vertical?: boolean }) {
  const zone = pctZone(value);
  const v = fmt(value, 0, '0');
  return (
    <View style={[styles.tile, vertical ? styles.pctV : styles.pctH]}>
      {vertical ? (
        <View>
          <Text style={styles.label}>{label}</Text>
          <Text style={[styles.value, { fontSize: 22 }, zone ? { color: zone } : null]}>
            {v}
            <Text style={styles.unit}>%</Text>
          </Text>
        </View>
      ) : (
        <View style={styles.pctHead}>
          <Text style={styles.label}>{label}</Text>
          <Text style={[styles.pctSmall, zone ? { color: zone } : null]}>{v}%</Text>
        </View>
      )}
      <HatchBar pct={value} vertical={vertical} zone={zone} style={vertical ? { flex: 1 } : { height: 14 }} />
    </View>
  );
}

/** Since-refuel distance, hatched fuel-left bar and range. */
export function FuelStrip({
  km,
  litres,
  leftPct,
  rangeKm,
  card,
}: {
  km: number;
  litres: number;
  leftPct: number | null;
  rangeKm: number | null;
  card?: boolean; // portrait: two lines in a card
}) {
  const since = (
    <Text style={styles.stripTxt} numberOfLines={1}>
      Since refuel{' '}
      <Text style={{ color: C.fg }}>
        {fmt(km, 1, '0')} km · {fmt(litres, 2, '0.00')} L
      </Text>
    </Text>
  );
  const range = (
    <Text style={styles.stripTxt} numberOfLines={1}>
      Range <Text style={{ color: C.fg }}>{rangeKm == null ? '—' : `≈ ${Math.round(rangeKm)} km`}</Text>
    </Text>
  );
  const bar = <HatchBar pct={leftPct ?? 0} style={{ height: 14, flex: card ? undefined : 1 }} />;
  if (card) {
    return (
      <View style={[styles.tile, { gap: 8, paddingHorizontal: 14 }]}>
        <View style={styles.pctHead}>
          {since}
          {range}
        </View>
        {bar}
      </View>
    );
  }
  return (
    <View style={styles.strip}>
      {since}
      {bar}
      {range}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    backgroundColor: C.panel,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: R.tile,
    paddingVertical: 10,
    paddingHorizontal: 12,
    justifyContent: 'space-between',
  },
  tileSm: { borderRadius: R.small, paddingVertical: 5, paddingHorizontal: 9 },
  label: { color: C.muted, fontSize: 12 },
  value: { color: C.fg, fontWeight: '400', fontVariant: ['tabular-nums'] },
  unit: { color: C.dim, fontSize: 12 },
  pctV: { flex: 1, padding: 10, gap: 8 },
  pctH: { gap: 6 },
  pctHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  pctSmall: { color: C.fg, fontSize: 12, fontVariant: ['tabular-nums'] },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 34 },
  stripTxt: { color: C.muted, fontSize: 13 },
});
