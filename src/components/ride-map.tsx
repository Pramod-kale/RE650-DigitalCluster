/**
 * A recorded ride on the map, coloured by one metric, plus the bits around it
 * (metric switch, legend). Shared by the Rides list and the full ride screen.
 */
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  type LineLayerSpecification,
} from '@maplibre/maplibre-react-native';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { currentRide, flushRide } from '@/engine/ride';
import { readRide } from '@/storage/rideLog';
import {
  buildPins,
  buildTrack,
  METRICS,
  parseRideCsv,
  rideStats,
  STOPPED_COLOR,
  trackBounds,
  type Metric,
  type PinKind,
} from '@/storage/rideTrack';
import { C } from '@/theme/dash';
import { useMapStyle } from '@/theme/mapStyle';

export const PIN_COLORS: Record<PinKind, string> = {
  start: C.success,
  end: C.info,
  vmax: C.bright,
  stop: C.dim,
};
export const PIN_LABELS: Record<PinKind, string> = {
  start: 'Start',
  end: 'End',
  vmax: 'Top speed',
  stop: 'Stop ≥ 1 min',
};

type ColorExpr = NonNullable<NonNullable<LineLayerSpecification['paint']>['line-color']>;

function lineColor(metric: Metric): ColorExpr {
  const stops = METRICS[metric].bands.flatMap((b, i) => [i, b.color]);
  return ['match', ['get', 'band'], -1, STOPPED_COLOR, ...stops, STOPPED_COLOR] as ColorExpr;
}

const pinColor: ColorExpr = [
  'match',
  ['get', 'kind'],
  'start', PIN_COLORS.start,
  'end', PIN_COLORS.end,
  'vmax', PIN_COLORS.vmax,
  'stop', PIN_COLORS.stop,
  C.fg,
];

export type RideData = NonNullable<ReturnType<typeof loadRide>>;

function loadRide(name: string | null | undefined) {
  if (!name) return null;
  if (name === currentRide()) flushRide(); // include the last few seconds
  let text: string | null = null;
  try {
    text = readRide(name);
  } catch (e) {
    console.warn(`[ride] could not read ${name}`, e);
  }
  if (text == null) return null;
  const samples = parseRideCsv(text);
  return { samples, stats: rideStats(samples), bounds: trackBounds(samples), pins: buildPins(samples) };
}

export function useRideData(name: string | null | undefined) {
  return useMemo(() => loadRide(name), [name]);
}

export function fmtDur(s: number): string {
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m` : `${m} min`;
}

/** The coloured track; `padding` keeps it clear of overlays. */
export function RideMap({ ride, metric, padding = 40 }: { ride: RideData; metric: Metric; padding?: number }) {
  const mapStyle = useMapStyle();
  const lines = useMemo(() => buildTrack(ride.samples, metric), [ride, metric]);
  if (!ride.bounds) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>No GPS track for this ride.</Text>
        <Text style={styles.hint}>Rides recorded before GPS logging, or without location permission, have no route.</Text>
      </View>
    );
  }
  if (!mapStyle) return null;
  return (
    <Map style={StyleSheet.absoluteFill} mapStyle={mapStyle} logo={false} compass={false}>
      <Camera
        key={`${ride.bounds.join(',')}`}
        initialViewState={{
          bounds: ride.bounds,
          padding: { top: padding, right: padding, bottom: padding, left: padding },
        }}
      />
      <GeoJSONSource id="track" data={lines}>
        <Layer
          id="track-casing"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': C.bg, 'line-width': 8, 'line-opacity': 0.7 }}
        />
        <Layer
          id="track-line"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': lineColor(metric), 'line-width': 5 }}
        />
      </GeoJSONSource>
      <GeoJSONSource id="pins" data={ride.pins}>
        <Layer
          id="pins"
          type="circle"
          paint={{
            'circle-radius': 6,
            'circle-color': C.bg,
            'circle-stroke-width': 3,
            'circle-stroke-color': pinColor,
          }}
        />
      </GeoJSONSource>
    </Map>
  );
}

/** Outlined metric switch (Speed / Economy / RPM / Throttle). */
export function MetricChips({ metric, onChange }: { metric: Metric; onChange: (m: Metric) => void }) {
  return (
    <View style={styles.chips}>
      {(Object.keys(METRICS) as Metric[]).map((m) => (
        <Pressable
          key={m}
          onPress={() => onChange(m)}
          accessibilityRole="button"
          accessibilityState={{ selected: m === metric }}
          style={[styles.chip, m === metric && styles.chipOn]}>
          <Text style={[styles.chipTxt, m === metric && styles.chipTxtOn]}>{METRICS[m].label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** One-line colour key for the metric. */
export function Legend({ metric }: { metric: Metric }) {
  return (
    <View style={styles.legend}>
      {METRICS[metric].bands.map((b) => (
        <View key={b.label} style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: b.color }]} />
          <Text style={styles.legendTxt}>{b.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 6 },
  muted: { color: C.muted, fontSize: 15 },
  hint: { color: C.dim, fontSize: 13, textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.bg,
    justifyContent: 'center',
  },
  chipOn: { borderColor: C.muted },
  chipTxt: { color: C.muted, fontSize: 12 },
  chipTxtOn: { color: C.fg },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 8,
    rowGap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.bg,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  swatch: { width: 14, height: 4, borderRadius: 2 },
  legendTxt: { color: C.muted, fontSize: 11 },
});
