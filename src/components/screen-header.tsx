/** Top row of the secondary screens: round back button, title, then any chips. */
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { C } from '@/theme/dash';

import { PillButton } from './ui';

export function ScreenHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={styles.bar}>
      <PillButton icon="back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 },
  title: { color: C.fg, fontSize: 20, fontWeight: '500', marginRight: 4 },
});
