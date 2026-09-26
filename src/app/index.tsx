import { Image } from 'expo-image';
import { useKeepAwake } from 'expo-keep-awake';
import { Link, router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BigCell, cellBase } from '@/components/dash/big-cell';
import { MetricTile } from '@/components/dash/metric-tile';
import { StatusPill } from '@/components/dash/status-pill';
import { useObd, useRuntime } from '@/engine/hooks';
import { chooseFolder } from '@/engine/runtime';
import { fmtKmL } from '@/engine/units';
import { RPM_MAX, RPM_REDLINE, SPEED_MAX } from '@/obd/constants';
import { C, eotTone, fmt, voltTone } from '@/theme/dash';

export default function Dashboard() {
  useKeepAwake(); // phone is the bike's dash: never let the screen sleep
  const { data, session, tank, link } = useObd();
  const { ready, folderUri, storageError } = useRuntime();

  const speedPct = (data.speed / SPEED_MAX) * 100;
  const rpmPct = (data.rpm / RPM_MAX) * 100;
  const redlinePct = (RPM_REDLINE / RPM_MAX) * 100;

  return (
    <SafeAreaView style={styles.dash} edges={['left', 'right', 'top', 'bottom']}>
      <View style={styles.topbar}>
        <Image
          source={require('@/assets/images/logo_largo.webp')}
          style={styles.brand}
          contentFit="contain"
        />
        <StatusPill connected={data.connected} staleSeconds={data.staleSeconds} link={link} />
        <View style={styles.nav}>
          <Link href="/fuel" asChild>
            <Pressable style={styles.navBtn} hitSlop={8}>
              <Text style={styles.navTxt}>FUEL</Text>
            </Pressable>
          </Link>
          <Link href="/rides" asChild>
            <Pressable style={styles.navBtn} hitSlop={8}>
              <Text style={styles.navTxt}>RIDES</Text>
            </Pressable>
          </Link>
          <Link href="/settings" asChild>
            <Pressable style={styles.navBtn} hitSlop={8}>
              <Text style={styles.navTxt}>⚙</Text>
            </Pressable>
          </Link>
        </View>
      </View>

      {ready && (!folderUri || storageError) ? (
        <Pressable style={styles.banner} onPress={chooseFolder}>
          <Text style={styles.bannerTxt}>
            {storageError
              ? `⚠ ${storageError} — tap to pick the storage folder again`
              : '⚠ Tap to pick a storage folder (e.g. Documents/RE650) so rides & odometer survive reinstall'}
          </Text>
        </Pressable>
      ) : null}

      <View style={[styles.grid, !data.connected && styles.stale]}>
        <BigCell
          flex={1.6}
          label="SPEED"
          value={fmt(data.speed, 0, '0')}
          unit="km/h"
          pct={speedPct}
          ticks={['0', '100', String(SPEED_MAX)]}
        />
        <BigCell
          flex={1.2}
          label="RPM"
          value={fmt(data.rpm, 0, '0')}
          pct={rpmPct}
          ticks={['0', String(RPM_REDLINE), String(RPM_MAX)]}
          redlinePct={redlinePct}
          alert={data.rpm >= RPM_REDLINE}
        />
        <View style={[cellBase, styles.gear]}>
          <Text style={styles.micro}>GEAR</Text>
          <Text style={styles.gearNum} adjustsFontSizeToFit numberOfLines={1}>
            {data.gear ?? '–'}
          </Text>
        </View>
      </View>

      <View style={styles.strip}>
        <MetricTile label="OIL" value={fmt(data.eot, 0)} unit="°C" tone={eotTone(data.eot)} />
        <MetricTile label="AIR" value={fmt(data.iat, 0)} unit="°C" />
        <MetricTile
          label="VOLT"
          value={fmt(data.voltage, 1)}
          unit="V"
          tone={voltTone(data.voltage, data.connected)}
        />
        <MetricTile label="THROTTLE" value={fmt(data.tps, 0)} unit="%" />
        <MetricTile label="LOAD" value={fmt(data.load, 0)} unit="%" />
        <MetricTile label="km/L" value={fmtKmL(data.kmPerL)} tone="accent" />
      </View>

      <View style={styles.foot}>
        <Pressable
          onPress={() => router.push('/refuel')}
          style={({ pressed }) => [styles.tankBtn, pressed && styles.tankBtnPressed]}>
          <Text style={styles.tankTxt}>⛽ Refuel</Text>
        </Pressable>
        <Text style={styles.footTxt}>
          Since refuel <Text style={styles.b}>{fmt(tank.sinceFillL, 2, '0.00')}</Text> L ·{' '}
          <Text style={styles.b}>{fmt(tank.sinceFillKm, 1, '0')}</Text> km · avg{' '}
          <Text style={styles.b}>{fmtKmL(tank.kmPerL)}</Text> km/L
        </Text>
        <Text style={[styles.footTxt, styles.session]}>
          Session <Text style={styles.b}>{fmt(session.elapsedMin, 0)}</Text> min · Vmax{' '}
          <Text style={styles.b}>{fmt(session.vMax, 0)}</Text>
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  dash: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 10, paddingVertical: 6, gap: 6 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  brand: { height: 22, width: 110 },
  nav: { flexDirection: 'row', gap: 8 },
  navBtn: {
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: C.panel,
  },
  navTxt: { color: C.fg, fontSize: 12, letterSpacing: 1 },
  banner: {
    backgroundColor: '#3a2a05',
    borderColor: C.warn,
    borderWidth: 1,
    borderRadius: 6,
    padding: 6,
  },
  bannerTxt: { color: C.warn, fontSize: 12 },
  grid: { flex: 1, flexDirection: 'row', gap: 8, minHeight: 0 },
  stale: { opacity: 0.55 },
  micro: { fontSize: 10, letterSpacing: 2, color: C.muted, marginBottom: 2 },
  gear: { flex: 0.8, alignItems: 'center' },
  gearNum: {
    fontSize: 88,
    fontWeight: '800',
    color: C.info,
    fontVariant: ['tabular-nums'],
  },
  strip: { flexDirection: 'row', gap: 6 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  tankBtn: {
    backgroundColor: C.panel,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  tankBtnPressed: { backgroundColor: C.info },
  tankTxt: { color: C.fg, fontSize: 13 },
  footTxt: { color: C.muted, fontSize: 13 },
  b: { color: C.fg, fontWeight: '700' },
  session: { marginLeft: 'auto' },
});
