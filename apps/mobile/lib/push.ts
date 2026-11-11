import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * Native push setup for the WebView shell. The token is acquired here and
 * handed to the web app over the WebView bridge (see app/index.tsx), which
 * registers it against the logged-in session. FCM delivery means notifications
 * arrive even when the app is fully closed - the OS displays them with zero app
 * CPU, which the WebView's web-push service worker can never do (it's frozen
 * when backgrounded).
 *
 * The EAS projectId comes from EXPO_PUBLIC_EAS_PROJECT_ID (inlined by the Expo
 * bundler at build time). Without it there is no push token and native push is
 * off; the app still works.
 */
const EAS_PROJECT_ID: string | null =
  String(process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? '').trim() || null;

/** Android requires notification channels up front. 'calls' rings at max
 *  importance; everything else uses 'default'. Channel ids match the server's
 *  ExpoPushMessage.channelId in notifications-push.service. */
export async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Notifications',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
  });
  await Notifications.setNotificationChannelAsync('calls', {
    name: 'Calls',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 500, 500, 500],
  });
  // Calls for Do Not Disturb users: shown, but no sound and no vibration.
  await Notifications.setNotificationChannelAsync('calls-silent', {
    name: 'Calls (silent)',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: null,
    vibrationPattern: [0],
    enableVibrate: false,
  });
}

/** Answer and Decline buttons for silent call notifications (server sends
 *  categoryId 'call'). Answer opens the app on the call; Decline opens
 *  the app without navigating and declines the call over the web app's socket. */
export async function ensureNotificationCategories(): Promise<void> {
  await Notifications.setNotificationCategoryAsync('call', [
    { identifier: 'answer', buttonTitle: 'Answer', options: { opensAppToForeground: true } },
    { identifier: 'decline', buttonTitle: 'Decline', options: { opensAppToForeground: true } },
  ]).catch(() => undefined);
}

/**
 * Request permission (if needed) and return the Expo push token, or null if the
 * user declined, we're on an unsupported device/emulator, or anything throws.
 * Never rejects - push is best-effort.
 */
export async function registerForPushTokenAsync(): Promise<string | null> {
  try {
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return null;
    if (!EAS_PROJECT_ID) return null;

    const { data } = await Notifications.getExpoPushTokenAsync({
      projectId: EAS_PROJECT_ID,
    });
    return data ?? null;
  } catch {
    return null;
  }
}
