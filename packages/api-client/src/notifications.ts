import type {
  MarkAllNotificationsReadResponse,
  MarkNotificationOpenedResponse,
  MarkNotificationReadResponse,
  NotificationListResponse,
  NotificationPreferencesResponse,
  NotificationUnreadCountResponse,
  RegisterNotificationDeviceInput,
  UpdateNotificationPreferencesInput,
} from "@ega/contracts/notifications";

import type { ApiResult } from "./errors";
import type { HttpClient } from "./http";

export type NotificationsApi = {
  list(query?: { limit?: number; cursor?: string | null }): Promise<ApiResult<NotificationListResponse>>;
  unreadCount(): Promise<ApiResult<NotificationUnreadCountResponse>>;
  markRead(notificationId: string): Promise<ApiResult<MarkNotificationReadResponse>>;
  markOpened(notificationId: string): Promise<ApiResult<MarkNotificationOpenedResponse>>;
  markAllRead(): Promise<ApiResult<MarkAllNotificationsReadResponse>>;
  registerDevice(input: RegisterNotificationDeviceInput): Promise<ApiResult<{ ok: true; device: { id: string; installationId: string; platform: string; provider: string; isActive: boolean } }>>;
  unregisterDevice(installationId: string): Promise<ApiResult<{ ok: true }>>;
  preferences(): Promise<ApiResult<NotificationPreferencesResponse>>;
  updatePreferences(input: UpdateNotificationPreferencesInput): Promise<ApiResult<{ ok: true; preference: { notificationType: string; pushEnabled: boolean; emailEnabled: boolean } }>>;
};

export function createNotificationsApi(http: HttpClient): NotificationsApi {
  return {
    list(query = {}) {
      return http.request<NotificationListResponse>({
        path: "/api/notifications",
        query: {
          limit: query.limit !== undefined ? String(query.limit) : undefined,
          cursor: query.cursor ?? undefined,
        },
      });
    },
    unreadCount() {
      return http.request<NotificationUnreadCountResponse>({ path: "/api/notifications/unread-count" });
    },
    markRead(notificationId) {
      return http.request<MarkNotificationReadResponse>({
        path: `/api/notifications/${encodeURIComponent(notificationId)}/read`,
        method: "PATCH",
      });
    },
    markOpened(notificationId) {
      return http.request<MarkNotificationOpenedResponse>({
        path: `/api/notifications/${encodeURIComponent(notificationId)}/opened`,
        method: "PATCH",
      });
    },
    markAllRead() {
      return http.request<MarkAllNotificationsReadResponse>({
        path: "/api/notifications/read-all",
        method: "POST",
      });
    },
    registerDevice(input) {
      return http.request<{ ok: true; device: { id: string; installationId: string; platform: string; provider: string; isActive: boolean } }>({
        path: "/api/notifications/devices",
        method: "POST",
        body: input,
      });
    },
    unregisterDevice(installationId) {
      return http.request<{ ok: true }>({
        path: `/api/notifications/devices/${encodeURIComponent(installationId)}`,
        method: "DELETE",
      });
    },
    preferences() {
      return http.request<NotificationPreferencesResponse>({ path: "/api/notifications/preferences" });
    },
    updatePreferences(input) {
      return http.request<{ ok: true; preference: { notificationType: string; pushEnabled: boolean; emailEnabled: boolean } }>({
        path: "/api/notifications/preferences",
        method: "PATCH",
        body: input,
      });
    },
  };
}
