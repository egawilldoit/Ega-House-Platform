import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export const TASK_REMINDER_CHANNEL_ID = 'task-reminders';

export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(TASK_REMINDER_CHANNEL_ID, {
    name: 'Task Reminders',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#0a84ff',
    sound: 'default',
    enableVibrate: true,
    showBadge: true,
  });
}
