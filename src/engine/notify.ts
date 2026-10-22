/**
 * Ride notifications: "Ride paused — End / Keep" (its buttons work without
 * opening the app because the ride keeps JS running in the background, see
 * gps.ts), plus warnings when GPS or the bike data drops out mid-ride.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const CHANNEL = 'ride';
const CATEGORY = 'ride-paused';
const END = 'end';
const KEEP = 'keep';
const GPS_LOST_ID = 'gps-lost';
const NO_BIKE_ID = 'no-bike-data';

let pausedId: string | null = null;

/** Once at startup: permission, channel, buttons and the response handler. */
export async function setupNotifications(on: { end: () => void; keep: () => void }) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  Notifications.addNotificationResponseReceivedListener((r) => {
    if (r.actionIdentifier === END) on.end();
    else if (r.actionIdentifier === KEEP) on.keep();
    // A plain tap just opens the app; the dashboard banner offers the same choice.
  });
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: 'Ride',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    await Notifications.setNotificationCategoryAsync(CATEGORY, [
      {
        identifier: END,
        buttonTitle: 'End ride',
        options: { opensAppToForeground: false, isDestructive: true },
      },
      { identifier: KEEP, buttonTitle: 'Keep', options: { opensAppToForeground: false } },
    ]);
    await Notifications.requestPermissionsAsync();
  } catch (e) {
    console.warn('[notify] setup failed', e);
  }
}

export async function showRidePaused(autoEndMin: number) {
  await clearRidePaused();
  try {
    pausedId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Ride paused',
        body: `No bike data for 2 minutes. End the ride? It ends by itself in ${autoEndMin} min.`,
        categoryIdentifier: CATEGORY,
      },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
    });
  } catch (e) {
    console.warn('[notify] could not show pause prompt', e);
  }
}

export async function clearRidePaused() {
  const id = pausedId;
  pausedId = null;
  if (id) await Notifications.dismissNotificationAsync(id).catch(() => {});
}

async function showAlert(identifier: string, title: string, body: string) {
  try {
    await Notifications.scheduleNotificationAsync({
      identifier, // a repeat replaces the earlier one instead of stacking
      content: { title, body },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
    });
  } catch (e) {
    console.warn(`[notify] could not show ${identifier}`, e);
  }
}

async function clearAlert(identifier: string) {
  await Notifications.dismissNotificationAsync(identifier).catch(() => {});
}

export function showGpsLost() {
  return showAlert(
    GPS_LOST_ID,
    'GPS signal lost',
    'The route is not being recorded. Check that location is on for this app.',
  );
}

export function clearGpsLost() {
  return clearAlert(GPS_LOST_ID);
}

export function showNoBikeData() {
  return showAlert(
    NO_BIKE_ID,
    'Bike not connected',
    'You are moving but the OBD dongle is not sending data. Recording the GPS route only — check the dongle.',
  );
}

export function clearNoBikeData() {
  return clearAlert(NO_BIKE_ID);
}
