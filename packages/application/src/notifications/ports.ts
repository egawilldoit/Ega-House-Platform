import type { NotificationDeliveryMode, NotificationType } from "@ega/contracts";

import type { AuthenticatedActor } from "../auth/actor";
import type { RepositoryResult } from "../shared/result";

export type NotificationTargetInput = Readonly<{
  type: "task";
  id: string;
}>;

export type NotificationRecord = Readonly<{
  id: string;
  ownerUserId: string;
  type: NotificationType;
  title: string;
  body: string | null;
  targetType: string | null;
  targetId: string | null;
  idempotencyKey: string;
  readAt: string | null;
  openedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type NotificationDeviceRecord = Readonly<{
  id: string;
  ownerUserId: string;
  installationId: string;
  platform: "android";
  provider: "fcm";
  providerToken: string;
  isActive: boolean;
  lastSeenAt: string;
  invalidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type NotificationDeliveryRecord = Readonly<{
  id: string;
  notificationId: string;
  ownerUserId: string;
  channel: "push" | "email";
  deviceId: string | null;
  provider: "fcm" | "resend";
  status: "queued" | "sending" | "provider_accepted" | "retry_scheduled" | "invalid_endpoint" | "failed";
  providerMessageId: string | null;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
  lastErrorReason: string | null;
  providerAcceptedAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type NotificationPreferenceRecord = Readonly<{
  id: string;
  ownerUserId: string;
  notificationType: NotificationType;
  pushEnabled: boolean;
  emailEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export type CreateNotificationInput = Readonly<{
  type: NotificationType;
  title: string;
  body?: string | null;
  target?: NotificationTargetInput | null;
  idempotencyKey: string;
}>;

export type ListNotificationsQuery = Readonly<{
  limit?: number;
  cursor?: string | null;
}>;

export type ListNotificationsResult = Readonly<{
  notifications: NotificationRecord[];
  nextCursor: string | null;
}>;

export interface NotificationRepository {
  createNotification(
    actor: AuthenticatedActor,
    input: CreateNotificationInput,
  ): Promise<RepositoryResult<NotificationRecord>>;
  getNotification(
    actor: AuthenticatedActor,
    notificationId: string,
  ): Promise<RepositoryResult<NotificationRecord | null>>;
  listNotifications(
    actor: AuthenticatedActor,
    query: ListNotificationsQuery,
  ): Promise<RepositoryResult<ListNotificationsResult>>;
  countUnread(actor: AuthenticatedActor): Promise<RepositoryResult<number>>;
  markRead(
    actor: AuthenticatedActor,
    notificationId: string,
  ): Promise<RepositoryResult<NotificationRecord | null>>;
  markOpened(
    actor: AuthenticatedActor,
    notificationId: string,
  ): Promise<RepositoryResult<NotificationRecord | null>>;
  markAllRead(actor: AuthenticatedActor): Promise<RepositoryResult<number>>;
}

export interface NotificationDeviceRepository {
  claimDevice(
    actor: AuthenticatedActor,
    input: Readonly<{
      installationId: string;
      platform: "android";
      provider: "fcm";
      providerToken: string;
    }>,
  ): Promise<RepositoryResult<NotificationDeviceRecord>>;
  getDeviceByInstallationId(
    actor: AuthenticatedActor,
    installationId: string,
  ): Promise<RepositoryResult<NotificationDeviceRecord | null>>;
  deactivateDevice(
    actor: AuthenticatedActor,
    installationId: string,
  ): Promise<RepositoryResult<NotificationDeviceRecord | null>>;
  listActiveDevices(actor: AuthenticatedActor): Promise<RepositoryResult<NotificationDeviceRecord[]>>;
  deactivateByToken(ownerUserId: string, providerToken: string): Promise<RepositoryResult<void>>;
}

export interface NotificationDeliveryRepository {
  createDeliveries(
    actor: AuthenticatedActor,
    input: Readonly<{
      notificationId: string;
      deliveries: Array<{
        channel: "push" | "email";
        deviceId: string | null;
        provider: "fcm" | "resend";
      }>;
    }>,
  ): Promise<RepositoryResult<NotificationDeliveryRecord[]>>;
  listPending(
    query: Readonly<{ limit: number; nowIso: string }>,
  ): Promise<RepositoryResult<NotificationDeliveryRecord[]>>;
  listQueuedForNotification(
    actor: AuthenticatedActor,
    notificationId: string,
  ): Promise<RepositoryResult<NotificationDeliveryRecord[]>>;
  updateDelivery(
    deliveryId: string,
    patch: Partial<NotificationDeliveryRecord> & { nextAttemptAt?: string | null },
  ): Promise<RepositoryResult<NotificationDeliveryRecord | null>>;
  markSending(deliveryId: string): Promise<RepositoryResult<NotificationDeliveryRecord | null>>;
}

export interface NotificationPreferenceRepository {
  listPreferences(actor: AuthenticatedActor): Promise<RepositoryResult<NotificationPreferenceRecord[]>>;
  upsertPreference(
    actor: AuthenticatedActor,
    input: Readonly<{
      notificationType: NotificationType;
      pushEnabled?: boolean;
      emailEnabled?: boolean;
    }>,
  ): Promise<RepositoryResult<NotificationPreferenceRecord>>;
}

export type TaskReminderIntentRecord = Readonly<{
  id: string;
  ownerUserId: string;
  taskId: string;
  remindAt: string;
  deliveryMode: NotificationDeliveryMode;
  status: string;
  taskTitle: string | null;
}>;

export interface TaskReminderIntentRepository {
  findDueIntents(nowIso: string, limit: number): Promise<RepositoryResult<TaskReminderIntentRecord[]>>;
  claimIntent(reminderId: string, nowIso: string): Promise<RepositoryResult<TaskReminderIntentRecord | null>>;
  markProcessed(reminderId: string, nowIso: string): Promise<RepositoryResult<void>>;
  markFailed(reminderId: string, reason: string, nowIso: string): Promise<RepositoryResult<void>>;
}

export type PushProviderPayload = Readonly<{
  token: string;
  title: string;
  body: string | null;
  data: Record<string, string>;
}>;

export type PushProviderResult =
  | { ok: true; providerMessageId: string }
  | {
      ok: false;
      errorCode: "invalid_endpoint" | "transient" | "permanent" | "auth";
      errorReason: string;
      raw?: unknown;
    };

export interface PushProvider {
  send(payload: PushProviderPayload): Promise<PushProviderResult>;
}

export type EmailProviderPayload = Readonly<{
  to: string;
  subject: string;
  html: string;
}>;

export type EmailProviderResult =
  | { ok: true; providerMessageId?: string }
  | { ok: false; errorCode: "transient" | "permanent"; errorReason: string };

export interface EmailProvider {
  send(payload: EmailProviderPayload): Promise<EmailProviderResult>;
}

export interface EmailDestinationResolver {
  resolve(ownerUserId: string): Promise<string | null>;
}
