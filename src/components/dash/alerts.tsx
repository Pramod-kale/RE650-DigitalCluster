/**
 * Non-ride problems float as one banner over the top bar (most severe first,
 * dismissible for this app run). A paused ride asks with a modal, the only
 * ride message that needs a decision; other in-ride states change the chips.
 */
import { useEffect, useState } from 'react';
import { AppState, Modal, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { HatchBar, PillButton, R } from '@/components/ui';
import { keepAlive } from '@/engine/gps';
import { useNow, useObd, useRide, useRuntime } from '@/engine/hooks';
import { closeRide, keepRide, PAUSE_AUTO_END_MS } from '@/engine/ride';
import { chooseFolder } from '@/engine/runtime';
import { BT_NO_PERMISSION, BT_OFF, requestBtPermission } from '@/obd/bluetooth';
import { router } from 'expo-router';
import { C } from '@/theme/dash';

type Level = 'crit' | 'warn' | 'info';
type Banner = { key: string; level: Level; title: string; body: string; action: string; onPress: () => void };

const LOOK: Record<Level, { icon: IconName; color: string }> = {
  crit: { icon: 'error', color: C.danger },
  warn: { icon: 'warning', color: C.warn },
  info: { icon: 'info', color: C.info },
};

function useBackgroundAllowed(): boolean {
  const read = () => keepAlive?.isIgnoringBatteryOptimizations() ?? true;
  const [ok, setOk] = useState(read);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && setOk(read()));
    return () => sub.remove();
  }, []);
  return ok;
}

function useBanners(): Banner[] {
  const { ready, folderUri, storageError } = useRuntime();
  const { link } = useObd();
  const backgroundOk = useBackgroundAllowed();
  const out: Banner[] = [];
  if (!ready) return out;
  if (storageError) {
    out.push({ key: 'save', level: 'crit', title: 'Could not save', body: storageError, action: 'Pick again', onPress: chooseFolder });
  } else if (!folderUri) {
    out.push({
      key: 'folder',
      level: 'warn',
      title: 'No storage folder',
      body: 'rides and odometer are lost on reinstall',
      action: 'Pick folder',
      onPress: chooseFolder,
    });
  }
  if (link.includes(BT_OFF)) {
    out.push({
      key: 'bt-off',
      level: 'warn',
      title: 'Bluetooth is off',
      body: 'the dongle cannot connect',
      action: 'Settings',
      onPress: () => router.push('/settings'),
    });
  } else if (link.includes(BT_NO_PERMISSION)) {
    out.push({
      key: 'bt-perm',
      level: 'info',
      title: 'Nearby devices permission needed',
      body: 'to connect to the Bluetooth dongle',
      action: 'Allow',
      onPress: () => void requestBtPermission(),
    });
  }
  if (!backgroundOk) {
    out.push({
      key: 'background',
      level: 'info',
      title: 'Background running restricted',
      body: 'recording may stop with the screen off',
      action: 'Allow',
      onPress: () => keepAlive?.requestIgnoreBatteryOptimizations(),
    });
  }
  return out;
}

export function TopBanner() {
  const banners = useBanners();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const b = banners.find((x) => !dismissed.includes(x.key));
  if (!b) return null;
  const look = LOOK[b.level];
  return (
    <View style={styles.bannerWrap} pointerEvents="box-none">
      <View style={[styles.banner, { borderColor: look.color }]}>
        <Icon name={look.icon} color={look.color} />
        <Text style={styles.bannerTxt} numberOfLines={1}>
          <Text style={styles.bannerTitle}>{b.title}</Text> · {b.body}
        </Text>
        <PillButton label={b.action} strong onPress={b.onPress} style={styles.bannerBtn} />
        <PillButton icon="close" onPress={() => setDismissed((d) => [...d, b.key])} style={styles.bannerClose} />
      </View>
    </View>
  );
}

export function RidePausedModal() {
  const ride = useRide();
  const now = useNow();
  const open = ride.pausedAt != null && !ride.kept;
  const endsAt = (ride.pausedAt ?? 0) + PAUSE_AUTO_END_MS;
  const leftPct = open ? Math.max(0, ((endsAt - now) / PAUSE_AUTO_END_MS) * 100) : 0;
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={keepRide} supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.scrim}>
        <View style={styles.dialog}>
          <View style={styles.head}>
            <View style={styles.headIcon}>
              <Icon name="pause" color={C.info} />
            </View>
            <View>
              <Text style={styles.title}>Ride paused</Text>
              <Text style={styles.sub}>No bike data for 2 minutes</Text>
            </View>
          </View>
          <Text style={styles.body}>
            The ride resumes by itself when the engine starts. If you leave it, it ends at{' '}
            <Text style={{ color: C.fg }}>
              {new Date(endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
            .
          </Text>
          <HatchBar pct={leftPct} zone={C.info} style={{ height: 10 }} />
          <View style={styles.actions}>
            <PillButton label="End ride" onPress={closeRide} style={styles.action} />
            <PillButton label="Keep recording" strong onPress={keepRide} style={styles.action} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bannerWrap: { position: 'absolute', left: 0, right: 0, top: 8, alignItems: 'center', zIndex: 10 },
  banner: {
    width: '90%',
    maxWidth: 620,
    height: 48,
    paddingLeft: 14,
    paddingRight: 6,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: '#1c1d21',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    elevation: 8,
  },
  bannerTxt: { flex: 1, color: C.muted, fontSize: 13 },
  bannerTitle: { color: C.fg, fontWeight: '500' },
  bannerBtn: { height: 34 },
  bannerClose: { width: 34, height: 34, borderWidth: 0 },
  scrim: { flex: 1, backgroundColor: 'rgba(5,5,6,0.72)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  dialog: {
    width: '100%',
    maxWidth: 440,
    borderRadius: R.card + 2,
    borderWidth: 1,
    borderColor: '#3f3f46',
    backgroundColor: C.panel,
    padding: 22,
    gap: 14,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.info,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: C.fg, fontSize: 18, fontWeight: '500' },
  sub: { color: C.muted, fontSize: 13 },
  body: { color: C.muted, fontSize: 14, lineHeight: 21 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  action: { flex: 1, height: 48 },
});
