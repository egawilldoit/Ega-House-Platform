import * as Notifications from 'expo-notifications';

export type NotificationPermissionStatus = 'granted' | 'denied' | 'undetermined';

export async function getPermissionStatus(): Promise<NotificationPermissionStatus> {
  const perms = await Notifications.getPermissionsAsync();
  if (perms.granted) return 'granted';
  // iOS has provisional, Android has canAskAgain; for V1 we treat canAskAgain true as undetermined
  if (perms.canAskAgain) return 'undetermined';
  if (perms.status === 'denied') return 'denied';
  return perms.status === 'granted' ? 'granted' : 'undetermined';
}

export async function requestPermission(): Promise<NotificationPermissionStatus> {
  const result = await Notifications.requestPermissionsAsync();
  if (result.granted) return 'granted';
  if (result.canAskAgain) return 'undetermined';
  return 'denied';
}

/**
 * Contextual permission request: explains why before requesting.
 * Caller should show rationale UI before invoking this.
 */
export async function requestPermissionWithRationale(): Promise<NotificationPermissionStatus> {
  return requestPermission();
}

export function canOpenSettings(): boolean {
  // Linking.openSettings is available on both platforms; we expose for UI
  return true;
}
