/**
 * Live route of the open ride: grey line, cyan start ring, light-blue "you"
 * dot with a glow. The camera follows the latest point.
 */
import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import type { FeatureCollection } from 'geojson';
import { router } from 'expo-router';
import { useMemo, useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Hatch, PillButton, R } from '@/components/ui';
import { getTrack, getTrackVersion, subscribeTrack } from '@/engine/gps';
import { C } from '@/theme/dash';
import { useMapStyle } from '@/theme/mapStyle';

const ZOOM = 15;

export function MiniMap({
  recording,
  avgKmh,
  noBike,
}: {
  recording: boolean;
  avgKmh: number | null;
  noBike: boolean;
}) {
  const version = useSyncExternalStore(subscribeTrack, getTrackVersion);
  const mapStyle = useMapStyle();

  const data = useMemo(() => {
    const t = getTrack();
    if (!t.length) return null;
    const line: FeatureCollection = {
      type: 'FeatureCollection',
      features:
        t.length > 1
          ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: t.map((p) => [...p]) } }]
          : [],
    };
    return { line, start: [...t[0]] as [number, number], here: [...t[t.length - 1]] as [number, number] };
    // `version` changes whenever the track gets new points.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const point = (c: [number, number]): FeatureCollection => ({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } }],
  });

  return (
    <View style={styles.box}>
      {recording && data && mapStyle ? (
        <Map style={StyleSheet.absoluteFill} mapStyle={mapStyle} logo={false} compass={false}>
          <Camera center={data.here} zoom={ZOOM} duration={800} easing="ease" />
          <GeoJSONSource id="mm-line" data={data.line}>
            <Layer
              id="mm-line"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': C.dim, 'line-width': 4 }}
            />
          </GeoJSONSource>
          <GeoJSONSource id="mm-start" data={point(data.start)}>
            <Layer
              id="mm-start"
              type="circle"
              paint={{
                'circle-radius': 6,
                'circle-color': C.bg,
                'circle-stroke-width': 3,
                'circle-stroke-color': C.success,
              }}
            />
          </GeoJSONSource>
          <GeoJSONSource id="mm-here" data={point(data.here)}>
            <Layer id="mm-glow" type="circle" paint={{ 'circle-radius': 18, 'circle-color': C.info, 'circle-opacity': 0.16 }} />
            <Layer id="mm-here" type="circle" paint={{ 'circle-radius': 6, 'circle-color': C.info }} />
          </GeoJSONSource>
        </Map>
      ) : (
        <View style={styles.empty}>
          <Hatch color={C.border} gap={10} />
          <Text style={styles.emptyTxt}>{recording ? 'Waiting for GPS…' : 'The route shows here once a ride starts'}</Text>
        </View>
      )}

      {noBike ? (
        <View style={styles.strip}>
          <Text style={styles.stripTxt} numberOfLines={1}>
            Bike not connected — recording the GPS route only
          </Text>
        </View>
      ) : recording && avgKmh != null ? (
        <View style={styles.pill}>
          <Text style={styles.pillTxt}>
            Route · <Text style={{ color: C.fg }}>avg {Math.round(avgKmh)} km/h</Text>
          </Text>
        </View>
      ) : null}

      <PillButton
        icon="backToStart"
        label="Back to start"
        strong
        onPress={() => router.push('/trackback')}
        style={styles.back}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flex: 1,
    borderRadius: R.card,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.panel,
    overflow: 'hidden',
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  emptyTxt: { color: C.dim, fontSize: 13, textAlign: 'center' },
  pill: {
    position: 'absolute',
    left: 12,
    top: 12,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.bg,
    justifyContent: 'center',
  },
  pillTxt: { color: C.muted, fontSize: 12 },
  strip: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: 10,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.warn,
    backgroundColor: C.bg,
    justifyContent: 'center',
  },
  stripTxt: { color: C.warn, fontSize: 12 },
  back: { position: 'absolute', right: 12, bottom: 12, backgroundColor: C.bg },
});
