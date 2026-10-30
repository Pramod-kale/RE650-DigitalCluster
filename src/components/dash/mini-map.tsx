/**
 * Live route of the open ride: grey line, cyan start ring, light-blue "you"
 * dot with a glow. The camera follows the latest point. The expand button
 * opens it full screen (speed and gear stay visible there), where a place can
 * be searched and navigated to.
 */
import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import type { FeatureCollection, Position } from 'geojson';
import { router } from 'expo-router';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Modal, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NavBar, PlaceSearch, RoutePicker } from '@/components/dash/map-nav';
import { Hatch, PillButton, R } from '@/components/ui';
import { getTrack, getTrackVersion, subscribeTrack, type LonLat } from '@/engine/gps';
import { useObd } from '@/engine/hooks';
import { boundsOf } from '@/nav/navigate';
import { splitLines } from '@/nav/trackback';
import { useNavigation } from '@/nav/use-navigation';
import { C, fmt, speedColor } from '@/theme/dash';
import { useMapStyle } from '@/theme/mapStyle';

type Route = { line: FeatureCollection; start: LonLat; here: LonLat };
type Nav = ReturnType<typeof useNavigation>;
// What the map draws for navigation: the chosen route, the other choices, and
// either a box to fit (route preview) or nothing (follow the rider).
type NavLayer = {
  main: FeatureCollection;
  alt: FeatureCollection;
  dest: FeatureCollection;
  fit: [number, number, number, number] | null;
};

const NO_FEATURES: FeatureCollection = { type: 'FeatureCollection', features: [] };

function lines(ls: Position[][]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: ls
      .filter((l) => l.length > 1)
      .map((l) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: l } })),
  };
}

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

function LiveMap({
  route,
  zoom,
  nav,
  fitPadding,
}: {
  route: Route;
  zoom: number;
  nav?: NavLayer | null;
  fitPadding?: { top: number; right: number; bottom: number; left: number };
}) {
  const mapStyle = useMapStyle();
  if (!mapStyle) return null;
  const view = nav?.fit ? { bounds: nav.fit, padding: fitPadding } : { center: [...route.here] as LonLat, zoom };
  return (
    <Map style={StyleSheet.absoluteFill} mapStyle={mapStyle} logo={false} compass={false}>
      <Camera {...view} duration={800} easing="ease" />
      <GeoJSONSource id="mm-line" data={route.line}>
        <Layer
          id="mm-line"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': C.dim, 'line-width': 4 }}
        />
      </GeoJSONSource>
      <GeoJSONSource id="mm-nav-alt" data={nav?.alt ?? NO_FEATURES}>
        <Layer
          id="mm-nav-alt"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': C.outline, 'line-width': 5 }}
        />
      </GeoJSONSource>
      <GeoJSONSource id="mm-nav" data={nav?.main ?? NO_FEATURES}>
        <Layer
          id="mm-nav"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': C.info, 'line-width': 6 }}
        />
      </GeoJSONSource>
      <GeoJSONSource id="mm-dest" data={nav?.dest ?? NO_FEATURES}>
        <Layer
          id="mm-dest"
          type="circle"
          paint={{ 'circle-radius': 7, 'circle-color': C.warn, 'circle-stroke-width': 3, 'circle-stroke-color': C.bg }}
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

function navLayer(s: Nav['state'], progress: Nav['progress'], here: LonLat): NavLayer | null {
  if (s.phase === 'idle') return null;
  const dest: LonLat = [s.dest.lon, s.dest.lat];
  if (s.phase === 'active') {
    const main = progress ? splitLines(s.route.route, progress).ahead : s.route.line;
    return { main: lines([main]), alt: NO_FEATURES, dest: point(dest), fit: null };
  }
  const routes = s.routes ?? [];
  return {
    main: routes[s.pick] ? lines([routes[s.pick].line]) : NO_FEATURES,
    alt: lines(routes.filter((_, i) => i !== s.pick).map((r) => r.line)),
    dest: point(dest),
    fit: boundsOf(
      routes.map((r) => r.line),
      [[...here], [...dest]],
    ),
  };
}

/** Full-screen route, with the speed and gear kept in view, and place search. */
function ExpandedMap({ route, nav, onClose }: { route: Route; nav: Nav; onClose: () => void }) {
  const { data } = useObd();
  const { width, height } = useWindowDimensions();
  const wide = width > height;
  const layer = useMemo(() => navLayer(nav.state, nav.progress, route.here), [nav.state, nav.progress, route.here]);
  const s = nav.state;
  const search = (
    <PlaceSearch
      near={{ lat: route.here[1], lon: route.here[0] }}
      onPick={nav.choose}
      style={wide ? styles.searchWide : styles.searchTall}
    />
  );
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.full}>
        <LiveMap route={route} zoom={16} nav={layer} fitPadding={wide ? FIT_WIDE : FIT_TALL} />
        <SafeAreaView style={styles.fullOverlay} pointerEvents="box-none" edges={['top', 'bottom', 'left', 'right']}>
          <View pointerEvents="box-none">
            <View style={styles.fullTop} pointerEvents="box-none">
              <PillButton icon="close" onPress={onClose} style={styles.solidBg} />
              {wide ? search : null}
              <View style={styles.speedBox}>
                <Text style={[styles.speedNum, { color: speedColor(data.speed) }]}>{fmt(data.speed, 0, '0')}</Text>
                <Text style={styles.speedUnit}>km/h · gear {data.gear ?? '–'}</Text>
              </View>
            </View>
            {wide ? null : search}
          </View>
          <View style={[styles.fullBottom, wide && styles.fullBottomWide]} pointerEvents="box-none">
            {s.phase === 'preview' ? (
              <RoutePicker
                state={s}
                onMode={nav.setMode}
                onPick={nav.pick}
                onStart={nav.start}
                onCancel={nav.end}
                style={styles.sheet}
              />
            ) : s.phase === 'active' ? (
              <NavBar state={s} progress={nav.progress} leftS={nav.leftS} onEnd={nav.end} style={styles.sheet} />
            ) : (
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
            )}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

// Room left around a previewed route for the controls over the map.
const FIT_TALL = { top: 150, right: 40, bottom: 320, left: 40 };
const FIT_WIDE = { top: 90, right: 40, bottom: 40, left: 460 };

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
  // Navigation lives here, not in the full-screen view, so closing and
  // reopening the map keeps it; it ends with the ride.
  const nav = useNavigation();
  const { end: endNav, state: navState } = nav;
  useEffect(() => {
    if (!live && navState.phase !== 'idle') endNav();
  }, [live, navState.phase, endNav]);

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

      {expanded && route ? <ExpandedMap route={route} nav={nav} onClose={() => setExpanded(false)} /> : null}
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
  fullBottomWide: { justifyContent: 'flex-start' },
  sheet: { flex: 1, maxWidth: 420 },
  searchWide: { flex: 1, maxWidth: 480, marginHorizontal: 12 },
  searchTall: { marginTop: 10 },
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
