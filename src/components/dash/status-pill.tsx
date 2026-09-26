import { StyleSheet, Text, View } from 'react-native';

import { C } from '@/theme/dash';

type Props = { connected: boolean; staleSeconds: number | null; link: string };

/** Connection indicator (App.vue `conn`), with the poller's reason when down. */
export function StatusPill({ connected, staleSeconds, link }: Props) {
  let label: string;
  let color: string;
  if (connected) {
    label = link === 'mock data' ? 'Mock data' : 'Connected';
    color = C.success;
  } else if (staleSeconds != null && staleSeconds < 600) {
    label = `No data ${staleSeconds.toFixed(0)}s · ${link}`;
    color = C.warn;
  } else {
    label = link;
    color = C.warn;
  }
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color: connected ? C.fg : color }]} numberOfLines={1}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: 11, letterSpacing: 1, flexShrink: 1 },
});
