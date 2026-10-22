/**
 * Live route of the open ride: grey line, cyan start ring, light-blue "you"
 * dot with a glow. The camera follows the latest point. The expand button
 * opens it full screen (speed and gear stay visible there).
 */
import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import type { FeatureCollection } from 'geojson';
import { router } from 'expo-router';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Hatch, PillButton, R } from '@/components/ui';
import { getTrack, getTrackVersion, subscribeTrack, type LonLat } from '@/engine/gps';
import { useObd } from '@/engine/hooks';
import { C, fmt, speedColor } from '@/theme/dash';
import { useMapStyle } from '@/theme/mapStyle';

type Route = { line: FeatureCollection; start: LonLat; here: LonLat };

function point(c: LonLat): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [...c] } }],
  };
}

function useRoute(): Route | null {
  const version = useSyncExternalStore(subscribeTrack, getTrackVersion);
  return useMemo(() => {
    const t = getTrack();
    if (!t.length) return null;
    return {
      line: {
        type: 'FeatureCollection',
        features:
          t.length > 1
            ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: t.map((p) => [...p]) } }]
            : [],
      },
      start: t[0],
      here: t[t.length - 1],
    };
    // `version` changes whenever the track gets new points.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
}

function LiveMap({ route, zoom }: { route: Route; zoom: number }) {
  const mapStyle = useMapStyle();
  if (!mapStyle) return null;
  return (
    <Map style={StyleSheet.absoluteFill} mapStyle={mapStyle} logo={false} compass={false}>
      <Camera center={[...route.here]} zoom={zoom} duration={800} easing="ease" />
      <GeoJSONSource id="mm-line" data={route.line}>
        <Layer
          id="mm-line"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': C.dim, 'line-width': 4 }}
        />
      </GeoJSONSource>
      <GeoJSONSource id="mm-start" data={point(route.start)}>
        <Layer
          id="mm-start"
          type="circle"
          paint={{ 'circle-radius': 6, 'circle-color': C.bg, 'circle-stroke-width': 3, 'circle-stroke-color': C.success }}
        />
      </GeoJSONSource>
      <GeoJSONSource id="mm-here" data={point(route.here)}>
        <Layer id="mm-glow" type="circle" paint={{ 'circle-radius': 18, 'circle-color': C.info, 'circle-opacity': 0.16 }} />
        <Layer id="mm-here" type="circle" paint={{ 'circle-radius': 6, 'circle-color': C.info }} />
      </GeoJSONSource>
    </Map>
  );
}

function backToStart() {
  router.push('/trackback');
}

/** Full-screen route, with the speed and gear kept in view. */
function ExpandedMap({ route, onClose }: { route: Route; onClose: () => void }) {
  const { data } = useObd();
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.full}>
        <LiveMap route={route} zoom={16} />
        <SafeAreaView style={styles.fullOverlay} pointerEvents="box-none" edges={['top', 'bottom', 'left', 'right']}>
          <View style={styles.fullTop} pointerEvents="box-none">
            <PillButton icon="close" label="Close" strong onPress={onClose} style={styles.solidBg} />
            <View style={styles.speedBox}>
              <Text style={[styles.speedNum, { color: speedColor(data.speed) }]}>{fmt(data.speed, 0, '0')}</Text>
              <Text style={styles.speedUnit}>km/h · gear {data.gear ?? '–'}</Text>
            </View>
          </View>
          <View style={styles.fullBottom} pointerEvents="box-none">
            <PillButton
              icon="backToStart"
              label="Back to start"
              strong
              onPress={() => {
                onClose();
                backToStart();
              }}
              style={styles.solidBg}
            />
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

export function MiniMap({
  recording,
  avgKmh,
  noBike,
}: {
  recording: boolean;
  avgKmh: number | null;
  noBike: boolean;
}) {
  const route = useRoute();
  const [expanded, setExpanded] = useState(false);
  const live = recording && route != null;

  return (
    <View style={styles.box}>
      {live && !expanded ? (
        <LiveMap route={route} zoom={15} />
      ) : (
        <View style={styles.empty}>
          <Hatch color={C.border} gap={10} />
          <Text style={styles.emptyTxt}>
            {expanded ? '' : recording ? 'Waiting for GPS…' : 'The route shows here once a ride starts'}
          </Text>
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

      {live ? <PillButton icon="expand" onPress={() => setExpanded(true)} style={[styles.expand, styles.solidBg]} /> : null}
      <PillButton icon="backToStart" label="Back to start" strong onPress={backToStart} style={[styles.back, styles.solidBg]} />

      {expanded && route ? <ExpandedMap route={route} onClose={() => setExpanded(false)} /> : null}
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
    right: 60,
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
  solidBg: { backgroundColor: C.bg },
  expand: { position: 'absolute', right: 10, top: 10 },
  back: { position: 'absolute', right: 12, bottom: 12 },
  full: { flex: 1, backgroundColor: C.bg },
  fullOverlay: { ...StyleSheet.absoluteFill, padding: 16, justifyContent: 'space-between' },
  fullTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  fullBottom: { flexDirection: 'row', justifyContent: 'flex-end' },
  speedBox: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: R.tile,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.bg,
    alignItems: 'flex-end',
  },
  speedNum: { fontSize: 44, fontWeight: '300', fontVariant: ['tabular-nums'], lineHeight: 48 },
  speedUnit: { color: C.muted, fontSize: 12 },
});
