/**
 * GPS for ride tracks, and what keeps a ride recording while another app
 * (e.g. Google Maps) is in front:
 *  - expo-location background updates keep the process alive (Android
 *    foreground service with a notification; iOS "location" background mode,
 *    shown as the blue location pill). Only "while in use" permission is
 *    needed because updates start while the app is open.
 *  - Android also pauses JS timers in the background unless a headless JS task
 *    is active, which would freeze the OBD poll loop; the local RideKeepAlive
 *    module holds one open (plus a CPU wake lock) for the length of the ride.
 *    It starts even when location can't, so the bike data is still logged.
 * Mock rides get a synthetic track driven by the mock speed, so the ride map
 * can be tried without riding.
 */
import { requireOptionalNativeModule } from 'expo';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { AppRegistry } from 'react-native';

import { getLive } from './store';

const LOCATION_TASK = 'ride-location';
const KEEP_ALIVE_TASK = 'RideKeepAlive';
// Older fixes are not written (tunnel, lost signal). Fixes arrive every ~1 s
// and rows every ~1.2 s; reusing one for longer smears it along the road
// (5 s at 30 km/h put 40 m of repeated points into a real ride).
const MAX_FIX_AGE_MS = 2_000;
// Used for mock tracks when the phone has never had a fix. Arbitrary.
const DEMO_ANCHOR = { lat: 51.5007, lon: -0.1246 };
const KM_PER_DEG_LAT = 111.32;

type Fix = {
  lat: number;
  lon: number;
  alt: number | null;
  acc: number | null;
  /** km/h; null when the phone doesn't know. */
  speed: number | null;
  t: number;
};

// Android only; null on iOS, where timers keep running in the background.
export const keepAlive = requireOptionalNativeModule<{
  start(taskKey: string): void;
  stop(): void;
  isIgnoringBatteryOptimizations(): boolean;
  requestIgnoreBatteryOptimizations(): void;
}>('RideKeepAlive');

let permission: Promise<boolean> | null = null;
let running = false;
let starting = false;
let wanted = false;
let fix: Fix | null = null;
let lastKnown: { lat: number; lon: number } | null = null;
let mock: { lat: number; lon: number; heading: number; t: number; t0: number } | null = null;
let releaseKeepAlive: (() => void) | null = null;
let fixListener: ((speedKmh: number | null, t: number) => void) | null = null;

// ---------------------------------------------------------------------------
// Live route of the open ride, for the dashboard minimap. Points closer than
// TRACK_STEP_M are skipped; long rides are thinned so the line stays cheap.
// ---------------------------------------------------------------------------
export type LonLat = [number, number];
const TRACK_STEP_M = 15;
const TRACK_MAX_POINTS = 4000;
const TRACK_EMIT_MS = 2000;
let track: LonLat[] = [];
let trackVersion = 0;
let lastTrackEmit = 0;
let trackTimer: ReturnType<typeof setTimeout> | null = null;
const trackListeners = new Set<() => void>();

function metresBetween(a: LonLat, b: LonLat): number {
  const kx = KM_PER_DEG_LAT * 1000 * Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * KM_PER_DEG_LAT * 1000);
}

function emitTrack() {
  trackTimer = null;
  lastTrackEmit = Date.now();
  trackVersion++;
  trackListeners.forEach((l) => l());
}

function addTrackPoint(lat: number, lon: number) {
  const p: LonLat = [lon, lat];
  const last = track[track.length - 1];
  if (last && metresBetween(last, p) < TRACK_STEP_M) return;
  track.push(p);
  if (track.length > TRACK_MAX_POINTS) track = track.filter((_, i) => i % 2 === 0 || i === track.length - 1);
  if (trackTimer) return;
  trackTimer = setTimeout(emitTrack, Math.max(0, TRACK_EMIT_MS - (Date.now() - lastTrackEmit)));
}

export function subscribeTrack(l: () => void) {
  trackListeners.add(l);
  return () => {
    trackListeners.delete(l);
  };
}

/** Changes whenever the route gets new points (for useSyncExternalStore). */
export function getTrackVersion(): number {
  return trackVersion;
}

/** The open ride's route so far, oldest first. Do not mutate. */
export function getTrack(): readonly LonLat[] {
  return track;
}

// Both must be registered when the bundle loads, not from a component.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  LOCATION_TASK,
  async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    const p = data.locations[data.locations.length - 1];
    const ms = p.coords.speed;
    fix = {
      lat: p.coords.latitude,
      lon: p.coords.longitude,
      alt: p.coords.altitude,
      acc: p.coords.accuracy,
      speed: ms != null && ms >= 0 ? ms * 3.6 : null,
      t: p.timestamp,
    };
    if (wanted) addTrackPoint(fix.lat, fix.lon);
    try {
      fixListener?.(fix.speed, fix.t);
    } catch (e) {
      console.warn('[gps] fix listener failed', e);
    }
  },
);
AppRegistry.registerHeadlessTask(
  KEEP_ALIVE_TASK,
  () => () =>
    new Promise<void>((resolve) => {
      releaseKeepAlive = resolve;
    }),
);

/** Ask once per app run; called at startup so the prompt never appears mid-ride. */
export function requestPermission(): Promise<boolean> {
  permission ??= Location.requestForegroundPermissionsAsync()
    .then(async (r) => {
      if (r.granted) {
        const p = await Location.getLastKnownPositionAsync().catch(() => null);
        if (p) lastKnown = { lat: p.coords.latitude, lon: p.coords.longitude };
      }
      return r.granted;
    })
    .catch((e) => {
      console.warn('[gps] permission request failed', e);
      return false;
    });
  return permission;
}

let cleanup: Promise<void> | null = null;

/** Stop updates left registered by a previous run that was killed mid-ride. Runs once. */
export function stopStale(): Promise<void> {
  cleanup ??= (async () => {
    try {
      if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK);
      }
    } catch (e) {
      console.warn('[gps] stale cleanup failed', e);
    }
  })();
  return cleanup;
}

/** Called with every real fix (km/h, or null when unknown). Set once by ride.ts. */
export function onFix(l: (speedKmh: number | null, t: number) => void) {
  fixListener = l;
}

let startedAt = 0;

/**
 * How long the ride has gone without a fix: since the last one, or since GPS
 * was asked to start. 0 when no ride is recording.
 */
export function fixAge(t = Date.now()): number {
  if (!wanted) return 0;
  return t - Math.max(fix?.t ?? 0, startedAt);
}

/** Ride began: start GPS and background keep-alive. Safe to call repeatedly. */
export function start() {
  if (!wanted) {
    startedAt = Date.now();
    track = [];
    emitTrack();
    keepAlive?.start(KEEP_ALIVE_TASK);
  }
  wanted = true;
  void ensureRunning();
}

/** Try again to start location updates that failed to start. No-op otherwise. */
export function retry() {
  if (wanted && !running) void ensureRunning();
}

/** Ride closed. */
export function stop() {
  if (wanted) {
    keepAlive?.stop();
    releaseKeepAlive?.();
    releaseKeepAlive = null;
  }
  wanted = false;
  fix = null;
  mock = null;
  if (!running) return;
  running = false;
  Location.stopLocationUpdatesAsync(LOCATION_TASK).catch((e) =>
    console.warn('[gps] stop failed', e),
  );
}

async function ensureRunning() {
  if (running || starting) return;
  starting = true;
  try {
    await stopStale(); // never races a ride that starts right after launch
    if (!(await requestPermission()) || !wanted) return;
    // Android refuses to start the foreground service from the background; the
    // ride then records only while the app is open.
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 1000,
      distanceInterval: 0,
      activityType: Location.ActivityType.AutomotiveNavigation,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Recording ride',
        notificationBody: 'Logging bike data and route in the background.',
        notificationColor: '#58a6ff',
        killServiceOnDestroy: true,
      },
    });
    running = true;
    if (!wanted) stop(); // ride closed while we were starting
  } catch (e) {
    console.warn('[gps] background updates failed to start', e);
  } finally {
    starting = false;
  }
}

// ---------------------------------------------------------------------------
// Mock track: wanders around the last known position at the mock speed.
// ---------------------------------------------------------------------------
function mockFix(t: number): Fix {
  if (!mock) {
    const a = lastKnown ?? DEMO_ANCHOR;
    mock = { ...a, heading: 0, t, t0: t };
  }
  const dt = Math.min((t - mock.t) / 1000, 5);
  const km = (getLive().speed * dt) / 3600;
  // Slowly varying turn rate gives a meandering loop instead of a straight line.
  mock.heading += dt * 0.07 * Math.sin((t - mock.t0) / 30_000);
  mock.lat += (km * Math.cos(mock.heading)) / KM_PER_DEG_LAT;
  mock.lon +=
    (km * Math.sin(mock.heading)) / (KM_PER_DEG_LAT * Math.cos((mock.lat * Math.PI) / 180));
  mock.t = t;
  addTrackPoint(mock.lat, mock.lon);
  return { lat: mock.lat, lon: mock.lon, alt: null, acc: 5, speed: getLive().speed, t };
}

/** The lat, lon, alt, gps_acc CSV fields; empty when there is no fresh fix. */
export function csvFields(isMock: boolean, t = Date.now()): string[] {
  const f = isMock ? mockFix(t) : fix;
  if (!f || t - f.t > MAX_FIX_AGE_MS) return ['', '', '', ''];
  return [
    f.lat.toFixed(6),
    f.lon.toFixed(6),
    f.alt == null ? '' : f.alt.toFixed(1),
    f.acc == null ? '' : f.acc.toFixed(0),
  ];
}
