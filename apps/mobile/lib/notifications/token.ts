import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export async function getFcmDeviceToken(): Promise<string | null> {
  try {
    // Must use native FCM registration token, not ExpoPushToken
    const tokenResponse = await Notifications.getDevicePushTokenAsync();
    // Response shape: { type: 'fcm' | 'apns', data: string } or string?
    // expo-notifications returns { type, data } for FCM
    if (!tokenResponse) return null;
    if (typeof tokenResponse === 'string') return tokenResponse;
    const data = (tokenResponse as { data?: unknown; token?: unknown }).data ?? (tokenResponse as { token?: unknown }).token;
    if (typeof data === 'string' && data.length > 0) return data;
    // Fallback: stringify
    return null;
  } catch {
    return null;
  }
}

export function isAndroid(): boolean {
  return Platform.OS === 'android';
}
