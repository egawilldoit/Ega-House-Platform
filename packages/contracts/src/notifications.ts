export const NOTIFICATION_TYPE_VALUES = [
  "task_reminder",
  "task_comment_mention",
  "timer_state_change",
  "routine_reminder",
  "money_threshold",
  "daily_review",
  "weekly_review",
  "job_search_reminder",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPE_VALUES)[number];

export const NOTIFICATION_TARGET_TYPE_VALUES = [
  "task",
  "timer",
  "routine",
  "money",
  "review",
  "today",
] as const;
export type NotificationTargetType = (typeof NOTIFICATION_TARGET_TYPE_VALUES)[number];

/**
 * Target types that identify an entity row. They must carry a non-empty id.
 * Singleton target types (`review`, `today`) intentionally have a null id.
 */
export const NOTIFICATION_ENTITY_TARGET_TYPE_VALUES = [
  "task",
  "timer",
  "routine",
  "money",
] as const;
export type NotificationEntityTargetType =
  (typeof NOTIFICATION_ENTITY_TARGET_TYPE_VALUES)[number];

export const NOTIFICATION_DELIVERY_MODE_VALUES = ["push", "email", "both"] as const;
export type NotificationDeliveryMode = (typeof NOTIFICATION_DELIVERY_MODE_VALUES)[number];

export const NOTIFICATION_CHANNEL_VALUES = ["push", "email"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNEL_VALUES)[number];

export const NOTIFICATION_DELIVERY_STATUS_VALUES = [
  "queued",
  "sending",
  "provider_accepted",
  "retry_scheduled",
  "invalid_endpoint",
  "failed",
  "suppressed",
] as const;
export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUS_VALUES)[number];

export const NOTIFICATION_PROVIDER_VALUES = ["fcm", "resend"] as const;
export type NotificationProvider = (typeof NOTIFICATION_PROVIDER_VALUES)[number];

export const NOTIFICATION_PLATFORM_VALUES = ["android"] as const;
export type NotificationPlatform = (typeof NOTIFICATION_PLATFORM_VALUES)[number];

export function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPE_VALUES as readonly string[]).includes(value);
}

export function isNotificationTargetType(value: string): value is NotificationTargetType {
  return (NOTIFICATION_TARGET_TYPE_VALUES as readonly string[]).includes(value);
}

export function isNotificationEntityTargetType(
  value: string,
): value is NotificationEntityTargetType {
  return (NOTIFICATION_ENTITY_TARGET_TYPE_VALUES as readonly string[]).includes(value);
}

export function isNotificationDeliveryMode(value: string): value is NotificationDeliveryMode {
  return (NOTIFICATION_DELIVERY_MODE_VALUES as readonly string[]).includes(value);
}

export function isNotificationDeliveryStatus(
  value: string,
): value is NotificationDeliveryStatus {
  return (NOTIFICATION_DELIVERY_STATUS_VALUES as readonly string[]).includes(value);
}

export type NotificationTarget = {
  type: NotificationTargetType;
  /** Null only for singleton target types (`review`, `today`). */
  id: string | null;
};

export type Notification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  target: NotificationTarget | null;
  readAt: string | null;
  openedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NotificationDevice = {
  id: string;
  installationId: string;
  platform: NotificationPlatform;
  provider: NotificationProvider;
  isActive: boolean;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
};

export type NotificationDelivery = {
  id: string;
  notificationId: string;
  channel: NotificationChannel;
  deviceId: string | null;
  provider: NotificationProvider;
  status: NotificationDeliveryStatus;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
  lastErrorReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NotificationListResponse = {
  ok: true;
  notifications: Notification[];
  nextCursor: string | null;
};

export type NotificationUnreadCountResponse = {
  ok: true;
  unreadCount: number;
};

export type RegisterNotificationDeviceInput = {
  installationId: string;
  platform: NotificationPlatform;
  provider: NotificationProvider;
  providerToken: string;
};

export type UnregisterNotificationDeviceInput = {
  installationId: string;
};

export type NotificationPreferences = {
  notificationType: NotificationType;
  pushEnabled: boolean;
  emailEnabled: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type NotificationPreferencesResponse = {
  ok: true;
  preferences: NotificationPreferences[];
};

export type UpdateNotificationPreferencesInput = {
  notificationType: NotificationType;
  pushEnabled?: boolean;
  emailEnabled?: boolean;
};

/**
 * Owner-level quiet-hours window. Times are local wall-clock `HH:MM` values
 * interpreted in the owner's canonical Time Context timezone. A window whose
 * start is later than its end is an overnight window (e.g. 22:00–07:00).
 */
export type NotificationSettings = {
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  updatedAt?: string;
};

export type NotificationSettingsResponse = {
  ok: true;
  settings: NotificationSettings;
};

export type UpdateNotificationSettingsInput = {
  quietHoursEnabled?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
};

export type MarkNotificationReadResponse = {
  ok: true;
  notification: Notification;
};

export type MarkNotificationOpenedResponse = {
  ok: true;
  notification: Notification;
};

export type MarkAllNotificationsReadResponse = {
  ok: true;
  updatedCount: number;
};

export type CreateTaskReminderInputWithDeliveryMode = {
  remindAt: string;
  deliveryMode?: NotificationDeliveryMode;
};

export type PushNotificationPayload = {
  notificationId: string;
  type: NotificationType;
  targetType: NotificationTargetType | null;
  targetId: string | null;
};
