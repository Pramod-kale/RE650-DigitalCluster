/**
 * The dashboard. Landscape: speed card · minimap · throttle/load + readings,
 * fuel strip below. Portrait: the same blocks stacked. Greys carry the layout;
 * accents only mark zones (speed / rpm / throttle / load) and states.
 */
import { useKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RidePausedModal, TopBanner } from '@/components/dash/alerts';
import { MiniMap } from '@/components/dash/mini-map';
import { FuelStrip, PctTile, StatTile } from '@/components/dash/readings';
import { SpeedCard } from '@/components/dash/speed-card';
import { Chip, PillButton } from '@/components/ui';
import { useNow, useObd, useRide } from '@/engine/hooks';
import { fmtKmL } from '@/engine/units';
import { TANK_L } from '@/obd/constants';
import { parseRideName } from '@/storage/rideSummary';
import { C, eotTone, fmt, toneColor, voltTone, type Tone } from '@/theme/dash';

/** Accent for out-of-range readings only; normal values stay plain. */
function alarm(t: Tone, connected: boolean): string | undefined {
  if (!connected) return undefined;
  return t === 'warn' || t === 'danger' || t === 'cool' ? toneColor[t] : undefined;
}

function clock(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

export default function Dashboard() {
  useKeepAwake(); // phone is the bike's dash: never let the screen sleep
  const { data, session, tank, odometer, link } = useObd();
  const ride = useRide();
  const now = useNow();
  const { width, height } = useWindowDimensions();
  const portrait = height > width;

  const recording = ride.name != null;
  const startedAt = ride.name ? parseRideName(ride.name)?.startedAt : null;

  // ---- top bar chips
  const rec = recording ? (
    ride.pausedAt != null ? (
      <Chip icon="pause" label="Paused" />
    ) : (
      <Chip dot={C.danger} label="REC" value={startedAt ? clock(now - startedAt) : undefined} />
    )
  ) : null;
  const bike = ride.noBike ? (
    <Chip icon="bike" label="Bike lost · GPS only" tone={C.warn} />
  ) : data.connected ? (
    <Chip icon="bike" iconColor={C.success} label={link === 'mock data' ? 'Bike · mock' : 'Bike'} />
  ) : (
    <Chip icon="bike" label="Bike" value={link} />
  );
  const gps = ride.gpsLost ? (
    <Chip icon="gpsOff" label="GPS lost" tone={C.warn} />
  ) : (
    <Chip icon="gps" iconColor={recording ? C.success : undefined} label="GPS" />
  );
  const trip = <Chip icon="route" label="Trip" value={`${fmt(session.kmTotal, 1, '0')} km`} />;
  const refuel = <PillButton icon="fuel" label="Refuel" strong onPress={() => router.push('/fuel')} />;
  const rides = <PillButton icon="map" label="Rides" onPress={() => router.push('/rides')} />;
  const settings = <PillButton icon="settings" onPress={() => router.push('/settings')} />;

  // ---- fuel / range
  const leftL = Math.max(0, TANK_L - tank.sinceFillL);
  const kml = tank.kmPerL ?? odometer.kmPerL;
  const fuel = (
    <FuelStrip
      km={tank.sinceFillKm}
      litres={tank.sinceFillL}
      leftPct={(leftL / TANK_L) * 100}
      rangeKm={kml ? leftL * kml : null}
      card={portrait}
    />
  );

  const avgKmh = session.elapsedMin > 1 ? session.kmTotal / (session.elapsedMin / 60) : null;
  const map = <MiniMap recording={recording} avgKmh={avgKmh} noBike={ride.noBike} />;

  const tiles = (size: 'sm' | 'md') => [
    <StatTile key="oil" size={size} label="Oil" value={fmt(data.eot, 0)} unit="°C" color={alarm(eotTone(data.eot), data.connected)} />,
    <StatTile key="air" size={size} label="Air" value={fmt(data.iat, 0)} unit="°C" />,
    <StatTile
      key="batt"
      size={size}
      label="Battery"
      value={fmt(data.voltage, 1)}
      unit="V"
      color={alarm(voltTone(data.voltage, data.connected), data.connected)}
    />,
    <StatTile key="eco" size={size} label="Economy" value={fmtKmL(data.kmPerL)} unit="km/L" />,
  ];

  return (
    <SafeAreaView style={[styles.dash, portrait && styles.dashPortrait]} edges={['left', 'right', 'top', 'bottom']}>
      {portrait ? (
        <>
          <View style={styles.bar}>
            {rec}
            {bike}
            {gps}
            <View style={styles.push}>{settings}</View>
          </View>
          <View style={styles.bar}>
            {trip}
            <View style={[styles.push, styles.buttons]}>
              {rides}
              {refuel}
            </View>
          </View>
          <SpeedCard speed={data.speed} rpm={data.rpm} gear={data.gear} big={124} style={{ flex: 1.25 }} />
          <View style={{ flex: 1 }}>{map}</View>
          <View style={styles.grid3}>
            {tiles('md').map((t) => (
              <View key={t.key} style={styles.cell3}>
                {t}
              </View>
            ))}
            <View style={styles.cell3}>
              <PctTile label="Throttle" value={data.tps} />
            </View>
            <View style={styles.cell3}>
              <PctTile label="Load" value={data.load} />
            </View>
          </View>
          {fuel}
        </>
      ) : (
        <>
          <View style={styles.bar}>
            {rec}
            {bike}
            {gps}
            {trip}
            <View style={[styles.push, styles.buttons]}>
              {refuel}
              {rides}
              {settings}
            </View>
          </View>
          <View style={styles.main}>
            <SpeedCard speed={data.speed} rpm={data.rpm} gear={data.gear} big={110} style={styles.speedL} />
            {map}
            <View style={styles.right}>
              <View style={styles.pcts}>
                <PctTile label="Throttle" value={data.tps} vertical />
                <PctTile label="Load" value={data.load} vertical />
              </View>
              <View style={styles.grid2}>
                {tiles('sm').map((t) => (
                  <View key={t.key} style={styles.cell2}>
                    {t}
                  </View>
                ))}
              </View>
            </View>
          </View>
          {fuel}
        </>
      )}
      <TopBanner />
      <RidePausedModal />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  dash: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 20, paddingVertical: 12, gap: 10 },
  dashPortrait: { paddingHorizontal: 14 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40 },
  push: { marginLeft: 'auto' },
  buttons: { flexDirection: 'row', gap: 6 },
  main: { flex: 1, flexDirection: 'row', gap: 10, minHeight: 0 },
  speedL: { width: 268 },
  right: { width: 196, gap: 8 },
  pcts: { flex: 1, flexDirection: 'row', gap: 8, minHeight: 0 },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cell2: { width: 95 },
  grid3: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell3: { width: '31.8%', height: 72 },
});
