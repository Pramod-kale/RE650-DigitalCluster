import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  UserLocation,
  type CameraRef,
} from '@maplibre/maplibre-react-native';
import { useKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { requestPermission } from '@/engine/gps';
import { currentRide, flushRide } from '@/engine/ride';
import {
  ARRIVED_M,
  buildRoute,
  compass,
  locate,
  splitLines,
  targetBearing,
  type LatLon,
} from '@/nav/trackback';
import { listRides, readRide } from '@/storage/rideLog';
import { parseRideName } from '@/storage/rideSummary';
import { parseRideCsv, rideStats, trackBounds } from '@/storage/rideTrack';
import { C, fmt } from '@/theme/dash';
import { useMapStyle } from '@/theme/mapStyle';

const FOLLOW_ZOOM = 16;
const FIT_PADDING = { top: 40, right: 280, bottom: 40, left: 40 };
// Below this the GPS course is noise; show a compass direction instead of an arrow.
const MIN_COURSE_SPEED_MS = 2;
// Used for the arrival estimate when the ride has no moving average yet.
const FALLBACK_KMH = 30;

type Pos = LatLon & { acc: number; heading: number | null; speed: number | null };

/** The ride to trace back: the one asked for, else the open one, else the newest. */
function pickRide(param: string | undefined): string | null {
  if (param) return param;
  const open = currentRide();
  if (open) return open;
  return listRides(null)[0]?.name ?? null;
}

function fmtDist(m: number): string {
  return m >= 1000 ? `${fmt(m / 1000, m >= 10_000 ? 0 : 1)} km` : `${fmt(m, 0)} m`;
}

export default function TrackbackScreen() {
  useKeepAwake();
  const { ride: rideParam } = useLocalSearchParams<{ ride?: string }>();
  const mapStyle = useMapStyle();
  const camera = useRef<CameraRef>(null);
  const [follow, setFollow] = useState(true);
  const [pos, setPos] = useState<Pos | null>(null);
  // Landscape: panel on the right. Portrait: panel along the bottom.
  const { width, height } = useWindowDimensions();
  const portrait = height > width;
  const panelH = Math.round(height * 0.42);
  const fitPadding = portrait ? { top: 40, right: 40, bottom: panelH + 40, left: 40 } : FIT_PADDING;

  const trip = useMemo(() => {
    const name = pickRide(rideParam);
    if (!name) return null;
    if (name === currentRide()) flushRide(); // include the last few seconds
    let text: string | null = null;
    try {
      text = readRide(name);
    } catch (e) {
      console.warn(`[trackback] could not read ${name}`, e);
    }
    if (text == null) return null;
    const samples = parseRideCsv(text);
    return {
      name,
      route: buildRoute(samples),
      bounds: trackBounds(samples),
      avgKmh: rideStats(samples).avgMovingKmh ?? FALLBACK_KMH,
    };
  }, [rideParam]);

  useEffect(() => {
    let live = true;
    let sub: Location.LocationSubscription | null = null;
    requestPermission()
      .then((ok) =>
        ok
          ? Location.watchPositionAsync(
              { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 1 },
              (p) =>
                setPos({
                  lat: p.coords.latitude,
                  lon: p.coords.longitude,
                  acc: p.coords.accuracy ?? 0,
                  heading: p.coords.heading != null && p.coords.heading >= 0 ? p.coords.heading : null,
                  speed: p.coords.speed,
                }),
            )
          : null,
      )
      .then((s) => {
        if (live) sub = s;
        else s?.remove();
      })
      .catch((e) => console.warn('[trackback] location watch failed', e));
    return () => {
      live = false;
      sub?.remove();
    };
  }, []);

  const route = trip?.route;
  const progress = useMemo(
    () => (route && pos ? locate(route, pos, pos.acc) : null),
    [route, pos],
  );
  const lines = useMemo(() => {
    if (!route || route.pts.length < 2) return null;
    const { ahead, done } = progress
      ? splitLines(route, progress)
      : { ahead: route.pts.map((q) => [q.lon, q.lat]), done: [] };
    return {
      type: 'FeatureCollection' as const,
      features: [
        { type: 'Feature' as const, properties: { part: 'done' }, geometry: { type: 'LineString' as const, coordinates: done } },
        { type: 'Feature' as const, properties: { part: 'ahead' }, geometry: { type: 'LineString' as const, coordinates: ahead } },
      ].filter((f) => f.geometry.coordinates.length >= 2),
    };
  }, [route, progress]);

  if (!trip || !route || route.pts.length === 0 || !trip.bounds) {
    return (
      <SafeAreaView style={[styles.page, styles.center]}>
        <Text style={styles.muted}>
          {trip ? 'This ride has no GPS track to follow back.' : 'No ride to trace back yet.'}
        </Text>
        <Pressable style={styles.btn} onPress={() => router.back()}>
          <Text style={styles.btnTxt}>Close</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const start = route.pts[0];
  const last = route.pts[route.pts.length - 1];
  const bounds = trip.bounds;
  const remaining = progress ? progress.along + (progress.onTrack ? 0 : progress.offTrackM) : null;
  const arrived = progress != null && progress.onTrack && progress.along <= ARRIVED_M;
  const bearing = pos && progress ? targetBearing(route, pos, progress) : null;
  const moving = pos?.heading != null && (pos.speed ?? 0) >= MIN_COURSE_SPEED_MS;
  const startedAt = parseRideName(trip.name)?.startedAt;

  function showOverview() {
    setFollow(false);
    camera.current?.fitBounds(bounds, { padding: fitPadding, duration: 600 });
  }

  function recenter() {
    setFollow(true);
    camera.current?.zoomTo(FOLLOW_ZOOM, { duration: 400 });
  }

  return (
    <View style={styles.page}>
      {mapStyle ? (
        <Map style={StyleSheet.absoluteFill} mapStyle={mapStyle} logo={false}>
          <Camera
            ref={camera}
            initialViewState={{ center: [last.lon, last.lat], zoom: FOLLOW_ZOOM }}
            trackUserLocation={follow ? 'course' : undefined}
            onTrackUserLocationChange={(e) => {
              if (e.nativeEvent.trackUserLocation == null) setFollow(false); // rider panned
            }}
          />
          {lines ? (
            <GeoJSONSource id="trackback" data={lines}>
              <Layer
                id="tb-done"
                type="line"
                filter={['==', ['get', 'part'], 'done']}
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                paint={{ 'line-color': C.muted, 'line-width': 4, 'line-opacity': 0.5 }}
              />
              <Layer
                id="tb-ahead-casing"
                type="line"
                filter={['==', ['get', 'part'], 'ahead']}
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                paint={{ 'line-color': C.bg, 'line-width': 10, 'line-opacity': 0.7 }}
              />
              <Layer
                id="tb-ahead"
                type="line"
                filter={['==', ['get', 'part'], 'ahead']}
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                paint={{ 'line-color': C.info, 'line-width': 6 }}
              />
            </GeoJSONSource>
          ) : null}
          <GeoJSONSource
            id="tb-home"
            data={{ type: 'Point', coordinates: [start.lon, start.lat] }}>
            <Layer
              id="tb-home"
              type="circle"
              paint={{
                'circle-radius': 9,
                'circle-color': C.success,
                'circle-stroke-width': 3,
                'circle-stroke-color': C.bg,
              }}
            />
          </GeoJSONSource>
          <UserLocation heading />
        </Map>
      ) : null}

      <SafeAreaView
        style={portrait ? [styles.panelBottom, { height: panelH }] : styles.panel}
        edges={portrait ? ['bottom', 'left', 'right'] : ['top', 'bottom', 'right']}>
        <Text style={styles.micro}>BACK TO START</Text>
        {arrived ? (
          <Text style={styles.arrived}>You’re back at the start</Text>
        ) : remaining == null ? (
          <Text style={styles.muted}>Waiting for GPS…</Text>
        ) : (
          <>
            <Text style={styles.big}>{fmtDist(remaining)}</Text>
            <Text style={styles.sub}>
              ≈ {fmt((remaining / 1000 / trip.avgKmh) * 60, 0)} min at your ride average
            </Text>
            {bearing != null ? (
              moving ? (
                <Text
                  style={[
                    styles.arrow,
                    { transform: [{ rotate: `${bearing - (pos?.heading ?? 0)}deg` }] },
                  ]}>
                  ↑
                </Text>
              ) : (
                <Text style={styles.head}>Head {compass(bearing)}</Text>
              )
            ) : null}
            <Text style={[styles.status, { color: progress?.onTrack ? C.success : C.warn }]}>
              {progress?.onTrack
                ? 'On track'
                : `Off track · rejoin ${fmtDist(progress?.offTrackM ?? 0)} ${bearing != null ? compass(bearing) : ''}`}
            </Text>
          </>
        )}

        <View style={styles.btnRow}>
          <Pressable style={styles.btn} onPress={follow ? showOverview : recenter}>
            <Text style={styles.btnTxt}>{follow ? 'Overview' : 'Follow me'}</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={() => router.back()}>
            <Text style={styles.btnTxt}>Exit</Text>
          </Pressable>
        </View>
        <Text style={styles.file}>
          {startedAt ? `Ride of ${new Date(startedAt).toLocaleString()}` : trip.name}
          {' · '}
          {fmtDist(route.total)} recorded
        </Text>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  panel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: 240,
    padding: 14,
    gap: 6,
    backgroundColor: 'rgba(22,27,34,0.92)',
    borderLeftColor: C.border,
    borderLeftWidth: 1,
  },
  panelBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 14,
    gap: 6,
    backgroundColor: 'rgba(22,27,34,0.92)',
    borderTopColor: C.border,
    borderTopWidth: 1,
  },
  micro: { fontSize: 10, letterSpacing: 2, color: C.muted },
  big: { color: C.fg, fontSize: 44, fontWeight: '800', fontVariant: ['tabular-nums'] },
  sub: { color: C.muted, fontSize: 13 },
  arrow: { color: C.info, fontSize: 72, fontWeight: '800', textAlign: 'center' },
  head: { color: C.info, fontSize: 28, fontWeight: '700', marginVertical: 8 },
  status: { fontSize: 15, fontWeight: '600' },
  arrived: { color: C.success, fontSize: 26, fontWeight: '800' },
  muted: { color: C.muted, fontSize: 15 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 'auto' },
  btn: {
    flex: 1,
    alignItems: 'center',
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: C.panel,
  },
  btnTxt: { color: C.fg, fontSize: 15, fontWeight: '600' },
  file: { color: C.muted, fontSize: 11 },
});
