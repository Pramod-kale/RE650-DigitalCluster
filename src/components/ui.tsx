/**
 * Building blocks of the dashboard look: outlined pills, cards, and the
 * hatched progress bars. Everything is drawn with plain Views (no SVG module).
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { C, tint } from '@/theme/dash';

import { Icon, type IconName } from './icon';

export const R = { card: 22, tile: 18, small: 12 } as const;

export function Card({ style, children }: { style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Status pill: icon, label, optional value. `tone` outlines it dashed in an accent. */
export function Chip({
  icon,
  iconColor,
  dot,
  label,
  value,
  tone,
}: {
  icon?: IconName;
  iconColor?: string;
  dot?: string; // a filled dot instead of an icon (REC)
  label: string;
  value?: string;
  tone?: string;
}) {
  return (
    <View style={[styles.chip, tone ? { borderColor: tone, borderStyle: 'dashed' } : null]}>
      {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : null}
      {icon ? <Icon name={icon} size={15} color={tone ?? iconColor ?? C.muted} /> : null}
      <Text style={[styles.chipLabel, tone ? { color: tone } : null]} numberOfLines={1}>
        {label}
        {value ? <Text style={styles.chipValue}> {value}</Text> : null}
      </Text>
    </View>
  );
}

/** Rounded button; `strong` gets the brighter outline. Icon-only when no label. */
export function PillButton({
  icon,
  label,
  onPress,
  strong,
  color,
  style,
}: {
  icon?: IconName;
  label?: string;
  onPress: () => void;
  strong?: boolean;
  color?: string; // destructive etc.: outline + text in this accent
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label ?? icon}
      style={({ pressed }) => [
        styles.btn,
        !label && styles.btnIcon,
        strong && { borderColor: C.muted },
        color ? { borderColor: color } : null,
        pressed && { backgroundColor: C.panel },
        style,
      ]}>
      {icon ? <Icon name={icon} size={18} color={color ?? C.fg} /> : null}
      {label ? <Text style={[styles.btnTxt, color ? { color } : null]}>{label}</Text> : null}
    </Pressable>
  );
}

/**
 * Diagonal stripes filling the parent (the "empty" part of bars): one rotated
 * field of stripes, centred and clipped by the parent (which needs
 * overflow: hidden). No measuring, so it draws on the first frame.
 */
const HATCH_FIELD = 640;
export function Hatch({ color = C.line, gap = 7 }: { color?: string; gap?: number }) {
  const n = Math.ceil(HATCH_FIELD / gap);
  return (
    <View pointerEvents="none" style={styles.hatchClip}>
      <View style={[styles.hatchField, { gap: gap - 2 }]}>
        {Array.from({ length: n }, (_, i) => (
          <View key={i} style={{ width: 2, height: '100%', backgroundColor: color }} />
        ))}
      </View>
    </View>
  );
}

/**
 * Hatched track with an outlined fill. `zone` (an accent) colours the outline
 * and adds a faint tint; never a solid fill.
 */
export function HatchBar({
  pct,
  vertical,
  zone,
  style,
}: {
  pct: number;
  vertical?: boolean;
  zone?: string | null;
  style?: StyleProp<ViewStyle>;
}) {
  const p = `${Math.max(0, Math.min(100, pct))}%` as const;
  const radius = vertical ? R.small : 999;
  return (
    <View
      style={[
        styles.track,
        { borderRadius: radius, flexDirection: vertical ? 'column-reverse' : 'row' },
        style,
      ]}>
      <Hatch />
      {pct > 0 ? (
        <View
          style={[
            vertical ? { height: p, width: '100%' } : { width: p, height: '100%' },
            {
              borderRadius: radius,
              borderWidth: 1,
              borderColor: zone ?? C.muted,
              backgroundColor: zone ? tint(zone, 0.18) : C.bg,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

/** Segmented RPM bar: ticks light up, orange / red inside the zones. */
export function TickBar({
  value,
  max,
  step,
  warn,
  danger,
  height = 28,
}: {
  value: number;
  max: number;
  step: number;
  warn: number;
  danger: number;
  height?: number;
}) {
  const n = Math.round(max / step);
  return (
    <View style={[styles.ticks, { height }]}>
      {Array.from({ length: n }, (_, i) => {
        const at = (i + 1) * step;
        const lit = value >= at;
        const zone = at > danger ? C.danger : at > warn ? C.warn : null;
        return (
          <View
            key={i}
            style={[
              styles.tick,
              zone ? { borderColor: tint(zone, 0.35) } : null,
              at > danger ? { borderStyle: 'dashed' } : null,
              lit ? { backgroundColor: zone ?? C.barFill, borderColor: zone ?? C.barFill } : null,
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.panel,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: R.card,
  },
  chip: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chipLabel: { color: C.muted, fontSize: 13, flexShrink: 1 },
  chipValue: { color: C.fg },
  btn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  btnIcon: { width: 40, paddingHorizontal: 0 },
  btnTxt: { color: C.fg, fontSize: 13, fontWeight: '500' },
  track: {
    borderWidth: 1,
    borderColor: C.line,
    overflow: 'hidden',
  },
  hatchClip: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, overflow: 'hidden' },
  hatchField: {
    position: 'absolute',
    width: HATCH_FIELD,
    height: HATCH_FIELD,
    left: '50%',
    top: '50%',
    marginLeft: -HATCH_FIELD / 2,
    marginTop: -HATCH_FIELD / 2,
    flexDirection: 'row',
    transform: [{ rotate: '45deg' }],
  },
  ticks: { flexDirection: 'row', gap: 2 },
  tick: { flex: 1, borderRadius: 2, borderWidth: 1, borderColor: C.line },
});
