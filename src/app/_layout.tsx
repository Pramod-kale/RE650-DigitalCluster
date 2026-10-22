import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { init } from '@/engine/runtime';
import { C, F } from '@/theme/dash';

SplashScreen.preventAutoHideAsync();

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: C.bg, card: C.panel, text: C.fg, border: C.border },
};

export default function RootLayout() {
  useEffect(() => {
    // Poller + storage live for the whole app, not per screen.
    init();
    SplashScreen.hideAsync();
  }, []);

  return (
    <ThemeProvider value={theme}>
      <StatusBar style="light" hidden />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: C.panel },
          headerTintColor: C.fg,
          headerTitleStyle: { fontSize: F.stat },
          contentStyle: { backgroundColor: C.bg },
        }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
        <Stack.Screen name="rides" options={{ headerShown: false }} />
        <Stack.Screen name="ride/[name]" options={{ headerShown: false }} />
        <Stack.Screen name="trackback" options={{ headerShown: false }} />
        <Stack.Screen name="fuel" options={{ headerShown: false }} />
        <Stack.Screen name="refuel" options={{ title: 'Refuel' }} />
      </Stack>
    </ThemeProvider>
  );
}
