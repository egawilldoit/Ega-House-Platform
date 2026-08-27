import type {
  NotificationListResponse,
  NotificationPreferencesResponse,
  NotificationUnreadCountResponse,
} from '@ega/contracts/notifications';
import { getMobileEgaApiClient, unwrapApiResult } from '@/lib/api/ega';

export async function fetchNotifications(params: { limit?: number; cursor?: string | null } = {}): Promise<NotificationListResponse> {
  return unwrapApiResult(await getMobileEgaApiClient().notifications.list(params));
}

export async function fetchUnreadCount(): Promise<NotificationUnreadCountResponse> {
  return unwrapApiResult(await getMobileEgaApiClient().notifications.unreadCount());
}

export async function markNotificationRead(notificationId: string) {
  return unwrapApiResult(await getMobileEgaApiClient().notifications.markRead(notificationId));
}

export async function markNotificationOpened(notificationId: string) {
  return unwrapApiResult(await getMobileEgaApiClient().notifications.markOpened(notificationId));
}

export async function markAllNotificationsRead() {
  return unwrapApiResult(await getMobileEgaApiClient().notifications.markAllRead());
}

export async function fetchNotificationPreferences(): Promise<NotificationPreferencesResponse> {
  return unwrapApiResult(await getMobileEgaApiClient().notifications.preferences());
}

export async function updateNotificationPreference(input: { notificationType: 'task_reminder'; pushEnabled?: boolean; emailEnabled?: boolean }) {
  return unwrapApiResult(await getMobileEgaApiClient().notifications.updatePreferences(input));
}
