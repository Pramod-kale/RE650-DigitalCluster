/**
 * Navigation controls of the full-screen map: place search (recent places
 * until something is typed), the route picker, and the distance / arrival bar
 * while riding a route.
 */
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/icon';
import { PillButton, R } from '@/components/ui';
import {
  fmtClock,
  fmtDist,
  fmtDuration,
  MODES,
  OFF_ROUTE_M,
  searchPlaces,
  type Mode,
  type Place,
} from '@/nav/navigate';
import { distM, type LatLon, type Progress } from '@/nav/trackback';
import type { NavState } from '@/nav/use-navigation';
import { recentPlaces } from '@/storage/places';
import { C, tint } from '@/theme/dash';

const MIN_CHARS = 3;
const DEBOUNCE_MS = 350;

type Found = { term: string; places: Place[]; error: boolean };

export function PlaceSearch({
  near,
  onPick,
  style,
}: {
  near: LatLon | null;
  onPick: (p: Place) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  const nearRef = useRef(near);
  useEffect(() => {
    nearRef.current = near;
  });

  const term = q.trim();
  const searching = term.length >= MIN_CHARS;
  useEffect(() => {
    if (!searching) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      searchPlaces(term, nearRef.current, ctl.signal).then(
        (places) => setFound({ term, places, error: false }),
        (e) => e?.name !== 'AbortError' && setFound({ term, places: [], error: true }),
      );
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [term, searching]);

  const result = found?.term === term ? found : null;
  const places = searching ? (result?.places ?? []) : recentPlaces();
  const note = !searching
    ? places.length ? null : 'Type a place, area or address'
    : !result ? 'Searching…'
    : result.error ? 'Search failed — check the connection'
    : places.length ? null : 'Nothing found';

  const pick = (p: Place) => {
    Keyboard.dismiss();
    setQ('');
    setFocused(false);
    onPick(p);
  };

  return (
    <View style={style}>
      <View style={[styles.input, focused && { borderColor: C.muted }]}>
        <Icon name="search" size={18} color={C.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Search a place"
          placeholderTextColor={C.dim}
          returnKeyType="search"
          autoCorrect={false}
          style={styles.inputTxt}
        />
        {q ? (
          <Pressable onPress={() => setQ('')} hitSlop={10} accessibilityLabel="Clear search">
            <Icon name="close" size={18} color={C.muted} />
          </Pressable>
        ) : null}
      </View>
      {focused ? (
        <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
          {places.map((p, i) => (
            <Pressable
              key={`${p.lat},${p.lon},${i}`}
              onPress={() => pick(p)}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: C.panel }]}>
              <Icon name={searching ? 'gps' : 'history'} size={18} color={C.dim} />
              <View style={styles.rowTxt}>
                <Text style={styles.rowName} numberOfLines={1}>{p.name}</Text>
                {p.detail ? <Text style={styles.rowDetail} numberOfLines={1}>{p.detail}</Text> : null}
              </View>
              {near ? <Text style={styles.rowDist}>{fmtDist(distM(near, p))}</Text> : null}
            </Pressable>
          ))}
          {note ? <Text style={styles.note}>{note}</Text> : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

export function RoutePicker({
  state,
  onMode,
  onPick,
  onStart,
  onCancel,
  style,
}: {
  state: Extract<NavState, { phase: 'preview' }>;
  onMode: (m: Mode) => void;
  onPick: (i: number) => void;
  onStart: () => void;
  onCancel: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { dest, mode, routes, pick, error } = state;
  return (
    <View style={[styles.card, style]}>
      <Text style={styles.title} numberOfLines={1}>{dest.name}</Text>
      {dest.detail ? <Text style={styles.sub} numberOfLines={1}>{dest.detail}</Text> : null}

      <View style={styles.modes}>
        {MODES.map((m) => (
          <Pressable
            key={m.mode}
            onPress={() => m.mode !== mode && onMode(m.mode)}
            style={[styles.mode, m.mode === mode && styles.modeOn]}>
            <Icon name={m.mode === 'bike' ? 'bike' : 'car'} size={16} color={m.mode === mode ? C.info : C.muted} />
            <Text style={[styles.modeTxt, m.mode === mode && { color: C.info }]}>{m.label}</Text>
          </Pressable>
        ))}
      </View>

      {error ? (
        <Text style={[styles.sub, { color: C.warn }]}>{error}</Text>
      ) : !routes ? (
        <Text style={styles.sub}>Finding routes…</Text>
      ) : (
        routes.map((r, i) => (
          <Pressable key={i} onPress={() => onPick(i)} style={[styles.route, i === pick && styles.routeOn]}>
            <View style={[styles.swatch, { backgroundColor: i === pick ? C.info : C.outline }]} />
            <Text style={styles.routeTime}>{fmtDuration(r.timeS)}</Text>
            <Text style={styles.routeKm}>{fmtDist(r.km * 1000)}</Text>
            {i === 0 ? <Text style={styles.routeTag}>Best</Text> : null}
          </Pressable>
        ))
      )}

      <View style={styles.actions}>
        <PillButton label="Cancel" onPress={onCancel} />
        {error ? (
          <PillButton icon="route" label="Retry" strong onPress={() => onMode(mode)} />
        ) : (
          <PillButton icon="navigation" label="Start" strong color={routes ? C.info : C.dim} onPress={onStart} />
        )}
      </View>
    </View>
  );
}

export function NavBar({
  state,
  progress,
  leftS,
  onEnd,
  style,
}: {
  state: Extract<NavState, { phase: 'active' }>;
  progress: Progress | null;
  leftS: number | null;
  onEnd: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  if (state.arrived) {
    return (
      <View style={[styles.card, styles.barRow, style]}>
        <Icon name="ok" size={24} color={C.success} />
        <View style={styles.barTxt}>
          <Text style={styles.title}>Arrived</Text>
          <Text style={styles.sub} numberOfLines={1}>{state.dest.name}</Text>
        </View>
        <PillButton label="Done" strong onPress={onEnd} />
      </View>
    );
  }
  const off = progress != null && progress.offTrackM > OFF_ROUTE_M;
  const status = state.rerouting ? 'Finding a new route…' : off ? 'Off route' : null;
  return (
    <View style={[styles.card, styles.barRow, style]}>
      <View style={styles.barTxt}>
        <Text style={styles.big}>
          {progress ? fmtDist(progress.along) : '–'}
          {leftS != null ? (
            <Text style={styles.bigSub}>
              {'  '}{fmtDuration(leftS)} · {fmtClock(leftS)}
            </Text>
          ) : null}
        </Text>
        <Text style={[styles.sub, status ? { color: C.warn } : null]} numberOfLines={1}>
          {status ?? `to ${state.dest.name}`}
        </Text>
      </View>
      <PillButton label="End" color={C.danger} onPress={onEnd} />
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.bg,
  },
  inputTxt: { flex: 1, color: C.fg, fontSize: 15, paddingVertical: 0 },
  list: {
    marginTop: 6,
    maxHeight: 300,
    borderRadius: R.small,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.bg,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  rowTxt: { flex: 1 },
  rowName: { color: C.fg, fontSize: 14 },
  rowDetail: { color: C.dim, fontSize: 12, marginTop: 1 },
  rowDist: { color: C.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  note: { color: C.dim, fontSize: 13, padding: 12 },
  card: {
    padding: 14,
    gap: 8,
    borderRadius: R.tile,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.bg,
  },
  title: { color: C.bright, fontSize: 16, fontWeight: '500' },
  sub: { color: C.muted, fontSize: 13 },
  modes: { flexDirection: 'row', gap: 8, marginTop: 2 },
  mode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.line,
  },
  modeOn: { borderColor: C.info, backgroundColor: tint(C.info) },
  modeTxt: { color: C.muted, fontSize: 13 },
  route: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: R.small,
    borderWidth: 1,
    borderColor: C.border,
  },
  routeOn: { borderColor: C.info },
  swatch: { width: 14, height: 4, borderRadius: 2 },
  routeTime: { color: C.fg, fontSize: 15, fontVariant: ['tabular-nums'] },
  routeKm: { color: C.muted, fontSize: 13, flex: 1 },
  routeTag: { color: C.success, fontSize: 12 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  barTxt: { flex: 1 },
  big: { color: C.bright, fontSize: 24, fontVariant: ['tabular-nums'] },
  bigSub: { color: C.muted, fontSize: 14 },
});
