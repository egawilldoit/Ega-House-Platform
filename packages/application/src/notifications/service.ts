import {
  isNotificationType,
  type NotificationSettings,
  type NotificationType,
} from "@ega/contracts";
import { isValidIANATimeZone } from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import type { TimeContextRepository } from "../shared/time-context";

import type {
  CreateNotificationInput,
  EmailDestinationResolver,
  EmailProvider,
  ListNotificationsQuery,
  NotificationDeliveryRepository,
  NotificationDeviceRepository,
  NotificationPreferenceRepository,
  NotificationRecord,
  NotificationRepository,
  NotificationSettingsRecord,
  NotificationSettingsRepository,
  PushProvider,
  TaskReminderIntentRepository,
} from "./ports";
import { buildPushDataPayload, nextRetryAt, resolveDeliveryChannels } from "./delivery";
import {
  buildNotificationEventKey,
  isNotificationTypeCritical,
  isValidClockTime,
  isWithinQuietHours,
  normalizeNotificationEventKey,
  normalizeNotificationTarget,
  sanitizeNotificationCopy,
} from "./policy";

function requireActor(actor: AuthenticatedActor) {
  if (!actor?.userId) return applicationFailure("Authentication required.");
  return null;
}

export type CreateNotificationResult = Readonly<{
  notification: NotificationRecord;
  created: boolean;
}>;

export async function createNotification(
  actor: AuthenticatedActor,
  repository: NotificationRepository,
  input: CreateNotificationInput,
): Promise<ApplicationResult<CreateNotificationResult>> {
  const err = requireActor(actor);
  if (err) return err;

  if (!isNotificationType(input.type)) {
    return applicationFailure("Unsupported notification type.");
  }
  const eventKey = normalizeNotificationEventKey(input.type, input.idempotencyKey);
  if (!eventKey) {
    return applicationFailure("A valid notification event key is required.");
  }

  const copy = sanitizeNotificationCopy(input.type, input.title, input.body);
  if (!copy.title) return applicationFailure("Notification title is required.");

  const target = input.target
    ? normalizeNotificationTarget(input.target.type, input.target.id)
    : null;

  const result = await repository.createNotification(actor, {
    ...input,
    title: copy.title,
    body: copy.body,
    target,
    idempotencyKey: eventKey,
  });
  if (!result.ok) return applicationFailure("Unable to create notification right now.");
  return applicationSuccess(result.value);
}

export async function listNotifications(
  actor: AuthenticatedActor,
  repository: NotificationRepository,
  query: ListNotificationsQuery = {},
): Promise<ApplicationResult<{ notifications: NotificationRecord[]; nextCursor: string | null }>> {
  const err = requireActor(actor);
  if (err) return err;

  const limit = Math.min(Math.max(Number(query.limit ?? 25), 1), 100);
  const result = await repository.listNotifications(actor, {
    limit,
    cursor: query.cursor ?? null,
  });
  if (!result.ok) return applicationFailure("Unable to load notifications right now.");
  return applicationSuccess(result.value);
}

export async function getUnreadCount(
  actor: AuthenticatedActor,
  repository: NotificationRepository,
): Promise<ApplicationResult<{ unreadCount: number }>> {
  const err = requireActor(actor);
  if (err) return err;
  const result = await repository.countUnread(actor);
  if (!result.ok) return applicationFailure("Unable to load unread count right now.");
  return applicationSuccess({ unreadCount: result.value });
}

export async function markNotificationRead(
  actor: AuthenticatedActor,
  repository: NotificationRepository,
  notificationId: string,
): Promise<ApplicationResult<NotificationRecord>> {
  const err = requireActor(actor);
  if (err) return err;
  if (!notificationId?.trim()) return applicationFailure("Notification id is required.");
  const result = await repository.markRead(actor, notificationId);
  if (!result.ok) return applicationFailure("Unable to update notification right now.");
  if (!result.value) return applicationFailure("Notification not found.");
  return applicationSuccess(result.value);
}

export async function markNotificationOpened(
  actor: AuthenticatedActor,
  repository: NotificationRepository,
  notificationId: string,
): Promise<ApplicationResult<NotificationRecord>> {
  const err = requireActor(actor);
  if (err) return err;
  if (!notificationId?.trim()) return applicationFailure("Notification id is required.");
  const result = await repository.markOpened(actor, notificationId);
  if (!result.ok) return applicationFailure("Unable to update notification right now.");
  if (!result.value) return applicationFailure("Notification not found.");
  return applicationSuccess(result.value);
}

export async function markAllNotificationsRead(
  actor: AuthenticatedActor,
  repository: NotificationRepository,
): Promise<ApplicationResult<{ updatedCount: number }>> {
  const err = requireActor(actor);
  if (err) return err;
  const result = await repository.markAllRead(actor);
  if (!result.ok) return applicationFailure("Unable to update notifications right now.");
  return applicationSuccess({ updatedCount: result.value });
}

export async function getNotificationPreferences(
  actor: AuthenticatedActor,
  repository: NotificationPreferenceRepository,
): Promise<ApplicationResult<Array<{ notificationType: NotificationType; pushEnabled: boolean; emailEnabled: boolean }>>> {
  const err = requireActor(actor);
  if (err) return err;
  const result = await repository.listPreferences(actor);
  if (!result.ok) return applicationFailure("Unable to load preferences right now.");
  // Ensure the legacy task reminder default entry keeps the mobile settings
  // screen working even before the owner stores an explicit preference.
  const hasTaskReminder = result.value.some((p) => p.notificationType === "task_reminder");
  if (!hasTaskReminder) {
    return applicationSuccess([
      ...result.value.map((p) => ({
        notificationType: p.notificationType,
        pushEnabled: p.pushEnabled,
        emailEnabled: p.emailEnabled,
      })),
      { notificationType: "task_reminder" as const, pushEnabled: true, emailEnabled: true },
    ]);
  }
  return applicationSuccess(
    result.value.map((p) => ({
      notificationType: p.notificationType,
      pushEnabled: p.pushEnabled,
      emailEnabled: p.emailEnabled,
    })),
  );
}

export async function updateNotificationPreferences(
  actor: AuthenticatedActor,
  repository: NotificationPreferenceRepository,
  input: { notificationType: NotificationType; pushEnabled?: boolean; emailEnabled?: boolean },
): Promise<ApplicationResult<{ notificationType: NotificationType; pushEnabled: boolean; emailEnabled: boolean }>> {
  const err = requireActor(actor);
  if (err) return err;
  if (!isNotificationType(input.notificationType)) {
    return applicationFailure("Unsupported notification type.");
  }
  if (typeof input.pushEnabled !== "boolean" && typeof input.emailEnabled !== "boolean") {
    return applicationFailure("At least one preference field is required.");
  }
  const result = await repository.upsertPreference(actor, input);
  if (!result.ok) return applicationFailure("Unable to save preferences right now.");
  return applicationSuccess({
    notificationType: result.value.notificationType,
    pushEnabled: result.value.pushEnabled,
    emailEnabled: result.value.emailEnabled,
  });
}

export const DEFAULT_NOTIFICATION_SETTINGS = Object.freeze({
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
});

function mapSettingsRecord(record: NotificationSettingsRecord | null): NotificationSettings {
  if (!record) {
    return {
      quietHoursEnabled: DEFAULT_NOTIFICATION_SETTINGS.quietHoursEnabled,
      quietHoursStart: DEFAULT_NOTIFICATION_SETTINGS.quietHoursStart,
      quietHoursEnd: DEFAULT_NOTIFICATION_SETTINGS.quietHoursEnd,
    };
  }
  return {
    quietHoursEnabled: record.quietHoursEnabled,
    quietHoursStart: record.quietHoursStart,
    quietHoursEnd: record.quietHoursEnd,
    updatedAt: record.updatedAt ?? undefined,
  };
}

export async function getNotificationSettings(
  actor: AuthenticatedActor,
  repository: NotificationSettingsRepository,
): Promise<ApplicationResult<NotificationSettings>> {
  const err = requireActor(actor);
  if (err) return err;
  const result = await repository.getSettings(actor);
  if (!result.ok) return applicationFailure("Unable to load notification settings right now.");
  return applicationSuccess(mapSettingsRecord(result.value));
}

export async function updateNotificationSettings(
  actor: AuthenticatedActor,
  repository: NotificationSettingsRepository,
  input: {
    quietHoursEnabled?: boolean;
    quietHoursStart?: string;
    quietHoursEnd?: string;
  },
): Promise<ApplicationResult<NotificationSettings>> {
  const err = requireActor(actor);
  if (err) return err;

  const existing = await repository.getSettings(actor);
  if (!existing.ok) return applicationFailure("Unable to load notification settings right now.");
  const base = mapSettingsRecord(existing.value);

  const quietHoursEnabled =
    typeof input.quietHoursEnabled === "boolean" ? input.quietHoursEnabled : base.quietHoursEnabled;
  const quietHoursStart =
    typeof input.quietHoursStart === "string" ? input.quietHoursStart.trim() : base.quietHoursStart;
  const quietHoursEnd =
    typeof input.quietHoursEnd === "string" ? input.quietHoursEnd.trim() : base.quietHoursEnd;

  if (!isValidClockTime(quietHoursStart)) {
    return applicationFailure("quietHoursStart must use 24-hour HH:MM.", "validation");
  }
  if (!isValidClockTime(quietHoursEnd)) {
    return applicationFailure("quietHoursEnd must use 24-hour HH:MM.", "validation");
  }
  if (quietHoursStart === quietHoursEnd) {
    return applicationFailure("quietHoursStart and quietHoursEnd must differ.", "validation");
  }

  const result = await repository.upsertSettings(actor, {
    quietHoursEnabled,
    quietHoursStart,
    quietHoursEnd,
  });
  if (!result.ok) return applicationFailure("Unable to save notification settings right now.");
  return applicationSuccess(mapSettingsRecord(result.value));
}

export async function registerNotificationDevice(
  actor: AuthenticatedActor,
  repository: NotificationDeviceRepository,
  input: { installationId: string; platform: "android"; provider: "fcm"; providerToken: string },
): Promise<ApplicationResult<import("./ports").NotificationDeviceRecord>> {
  const err = requireActor(actor);
  if (err) return err;
  if (!input.installationId?.trim()) return applicationFailure("installationId is required.");
  if (!input.providerToken?.trim()) return applicationFailure("providerToken is required.");
  if (input.platform !== "android") return applicationFailure("Unsupported platform.");
  if (input.provider !== "fcm") return applicationFailure("Unsupported provider.");
  const result = await repository.claimDevice(actor, input);
  if (!result.ok) return applicationFailure("Unable to register device right now.");
  return applicationSuccess(result.value);
}

export async function unregisterNotificationDevice(
  actor: AuthenticatedActor,
  repository: NotificationDeviceRepository,
  installationId: string,
): Promise<ApplicationResult<{ ok: true }>> {
  const err = requireActor(actor);
  if (err) return err;
  if (!installationId?.trim()) return applicationFailure("installationId is required.");
  const result = await repository.deactivateDevice(actor, installationId);
  if (!result.ok) return applicationFailure("Unable to unregister device right now.");
  // Idempotent: if not found, still success
  return applicationSuccess({ ok: true });
}

export type QuietHoursResolution =
  | Readonly<{ status: "not_quiet" }>
  | Readonly<{ status: "quiet" }>
  /** An infrastructure read failed; callers must not guess quiet/awake. */
  | Readonly<{ status: "unavailable" }>;

async function resolveQuietHoursSuppression(args: {
  actor: AuthenticatedActor;
  notificationType: NotificationType;
  settingsRepository: NotificationSettingsRepository;
  timeContextRepository: TimeContextRepository;
  now: Date;
}): Promise<QuietHoursResolution> {
  if (!isNotificationType(args.notificationType)) return { status: "not_quiet" };
  // Critical events bypass quiet hours by policy.
  if (isNotificationTypeCritical(args.notificationType)) return { status: "not_quiet" };

  const settingsResult = await args.settingsRepository.getSettings(args.actor);
  if (!settingsResult.ok) return { status: "unavailable" };
  const settings = settingsResult.value;
  // No stored settings row = documented defaults (quiet hours disabled).
  if (!settings) return { status: "not_quiet" };
  if (!settings.quietHoursEnabled) return { status: "not_quiet" };

  // The owner timezone is the existing Time Context authority. A missing or
  // invalid timezone is a configuration state, not a read failure: safe
  // default is to not suppress and never guess from server local time.
  const timezoneResult = await args.timeContextRepository.getTimezone(args.actor);
  if (!timezoneResult.ok) return { status: "unavailable" };
  const timezone = timezoneResult.value?.trim() ?? "";
  if (!timezone || !isValidIANATimeZone(timezone)) return { status: "not_quiet" };

  return isWithinQuietHours({
    now: args.now,
    timezone,
    start: settings.quietHoursStart,
    end: settings.quietHoursEnd,
  })
    ? { status: "quiet" }
    : { status: "not_quiet" };
}

// Orchestration: due reminders → notification → deliveries

export type ProcessDueTaskRemindersOptions = {
  notificationRepository: NotificationRepository;
  deliveryRepository: NotificationDeliveryRepository;
  deviceRepository: NotificationDeviceRepository;
  preferenceRepository: NotificationPreferenceRepository;
  settingsRepository: NotificationSettingsRepository;
  timeContextRepository: TimeContextRepository;
  intentRepository: TaskReminderIntentRepository;
  now?: Date;
  limit?: number;
};

export type ProcessDueResult = {
  due: number;
  claimed: number;
  notificationsCreated: number;
  deliveriesQueued: number;
  suppressed: number;
  skipped: number;
};

export async function processDueTaskReminders(
  _actorForSystem: null,
  options: ProcessDueTaskRemindersOptions,
): Promise<ApplicationResult<ProcessDueResult>> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const limit = options.limit ?? 25;

  const dueResult = await options.intentRepository.findDueIntents(nowIso, limit);
  if (!dueResult.ok) return applicationFailure("Unable to load due reminders right now.");

  const counts: ProcessDueResult = {
    due: dueResult.value.length,
    claimed: 0,
    notificationsCreated: 0,
    deliveriesQueued: 0,
    suppressed: 0,
    skipped: 0,
  };

  for (const intent of dueResult.value) {
    const claimed = await options.intentRepository.claimIntent(intent.id, nowIso);
    if (!claimed.ok || !claimed.value) {
      counts.skipped += 1;
      continue;
    }
    counts.claimed += 1;

    const ownerActor: AuthenticatedActor = { userId: claimed.value.ownerUserId };

    // Fail closed on preference reads: a failed read is not "no preference".
    const prefsResult = await options.preferenceRepository.listPreferences(ownerActor);
    if (!prefsResult.ok) {
      // Do not create deliveries or mark processed; the intent remains
      // retryable through the existing lease/claim path.
      counts.skipped += 1;
      continue;
    }
    const pref = prefsResult.value.find((p) => p.notificationType === "task_reminder") ?? null;

    const channels = resolveDeliveryChannels({
      deliveryMode: claimed.value.deliveryMode,
      preferences: pref ? { pushEnabled: pref.pushEnabled, emailEnabled: pref.emailEnabled } : null,
    });

    // Fail closed on quiet-hours reads too: if the settings/timezone read
    // fails we do not know whether it is quiet, so do not dispatch or mark
    // processed. Invalid/missing timezone remains the documented safe default.
    const quiet = await resolveQuietHoursSuppression({
      actor: ownerActor,
      notificationType: "task_reminder",
      settingsRepository: options.settingsRepository,
      timeContextRepository: options.timeContextRepository,
      now,
    });
    if (quiet.status === "unavailable") {
      counts.skipped += 1;
      continue;
    }

    const title = "Task reminder";
    const body = claimed.value.taskTitle?.trim() || "You have a task reminder";
    const eventKey = buildNotificationEventKey("task_reminder", claimed.value.id);
    if (!eventKey) {
      counts.skipped += 1;
      continue;
    }

    // Every producer goes through the canonical use case so copy and target
    // policy are enforced at one boundary even for the live cron producer.
    const notifResult = await createNotification(ownerActor, options.notificationRepository, {
      type: "task_reminder",
      title,
      body,
      target: { type: "task", id: claimed.value.taskId },
      idempotencyKey: eventKey,
    });

    if (!notifResult.ok) {
      // Do not mark processed if notification creation failed; allow retry.
      counts.skipped += 1;
      continue;
    }

    if (notifResult.data.created) counts.notificationsCreated += 1;

    const deliveriesToCreate: Array<{
      channel: "push" | "email";
      deviceId: string | null;
      provider: "fcm" | "resend";
      status?: "queued" | "suppressed";
      lastErrorCode?: string | null;
      lastErrorReason?: string | null;
    }> = [];

    const suppressedFields = quiet.status === "quiet"
      ? {
          status: "suppressed" as const,
          lastErrorCode: "quiet_hours",
          lastErrorReason: "Suppressed during owner quiet hours.",
        }
      : {};

    if (channels.email) {
      deliveriesToCreate.push({
        channel: "email",
        deviceId: null,
        provider: "resend",
        ...suppressedFields,
      });
    }

    if (channels.push) {
      const devicesResult = await options.deviceRepository.listActiveDevices(ownerActor);
      if (devicesResult.ok) {
        for (const device of devicesResult.value) {
          deliveriesToCreate.push({
            channel: "push",
            deviceId: device.id,
            provider: "fcm",
            ...suppressedFields,
          });
        }
      }
      // If push desired but no devices, still keep the canonical notification.
    }

    if (deliveriesToCreate.length > 0) {
      const deliveryResult = await options.deliveryRepository.createDeliveries(ownerActor, {
        notificationId: notifResult.data.notification.id,
        deliveries: deliveriesToCreate,
      });

      if (!deliveryResult.ok) {
        // Do not mark processed; lease reclaim will retry idempotently.
        counts.skipped += 1;
        continue;
      }

      // `deliveriesQueued` means dispatchable (non-suppressed) rows; suppressed
      // rows are recorded separately as terminal results.
      counts.deliveriesQueued += deliveryResult.value.created.filter(
        (delivery) => delivery.status !== "suppressed",
      ).length;
      counts.suppressed += deliveryResult.value.created.filter(
        (delivery) => delivery.status === "suppressed",
      ).length;
    }

    // Mark reminder processed only after the event and deliveries are durable.
    await options.intentRepository.markProcessed(claimed.value.id, nowIso);
  }

  return applicationSuccess(counts);
}

export type ProcessDeliveriesOptions = {
  deliveryRepository: NotificationDeliveryRepository;
  deviceRepository: NotificationDeviceRepository;
  preferenceRepository: NotificationPreferenceRepository;
  settingsRepository: NotificationSettingsRepository;
  timeContextRepository: TimeContextRepository;
  pushProvider: PushProvider;
  emailProvider: EmailProvider;
  emailResolver: EmailDestinationResolver;
  notificationRepository: NotificationRepository;
  now?: Date;
  limit?: number;
};

export type ProcessDeliveriesResult = {
  processed: number;
  accepted: number;
  retried: number;
  invalidated: number;
  failed: number;
  suppressed: number;
};

async function markSuppressed(
  repository: NotificationDeliveryRepository,
  deliveryId: string,
  reasonCode: "opt_out" | "quiet_hours",
  reason: string,
  nowIso: string,
): Promise<void> {
  await repository.updateDelivery(deliveryId, {
    status: "suppressed",
    lastErrorCode: reasonCode,
    lastErrorReason: reason,
    nextAttemptAt: null,
    updatedAt: nowIso,
  });
}

/**
 * An infrastructure read (preferences/settings/timezone) failed. Do not call
 * the provider and do not guess opt-in/awake: defer explicitly, then fail with
 * an actionable code once the bounded retry budget is exhausted.
 */
async function deferDeliveryForInfrastructure(args: {
  repository: NotificationDeliveryRepository;
  delivery: { id: string; attemptCount: number };
  code: "preferences_unavailable" | "quiet_hours_unavailable";
  reason: string;
  now: Date;
  nowIso: string;
}): Promise<"retried" | "failed"> {
  const nextAttempt = nextRetryAt(args.delivery.attemptCount + 1, args.now);
  if (!nextAttempt) {
    await args.repository.updateDelivery(args.delivery.id, {
      status: "failed",
      lastErrorCode: args.code,
      lastErrorReason: args.reason,
      attemptCount: args.delivery.attemptCount + 1,
      failedAt: args.nowIso,
      updatedAt: args.nowIso,
      nextAttemptAt: null,
    });
    return "failed";
  }
  await args.repository.updateDelivery(args.delivery.id, {
    status: "retry_scheduled",
    lastErrorCode: args.code,
    lastErrorReason: args.reason,
    attemptCount: args.delivery.attemptCount + 1,
    nextAttemptAt: nextAttempt,
    updatedAt: args.nowIso,
  });
  return "retried";
}

export async function processPendingNotificationDeliveries(
  options: ProcessDeliveriesOptions,
): Promise<ApplicationResult<ProcessDeliveriesResult>> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const limit = options.limit ?? 25;

  const pendingResult = await options.deliveryRepository.listPending({ limit, nowIso });
  if (!pendingResult.ok) return applicationFailure("Unable to load pending deliveries right now.");

  const counts: ProcessDeliveriesResult = {
    processed: 0,
    accepted: 0,
    retried: 0,
    invalidated: 0,
    failed: 0,
    suppressed: 0,
  };

  for (const delivery of pendingResult.value) {
    // Claim the attempt. A delivery already `sending` is only reclaimed after
    // its lease expires; we never pretend it was unsent.
    const sending = await options.deliveryRepository.markSending(delivery.id);
    if (!sending.ok || !sending.value) continue;

    counts.processed += 1;

    const ownerActor: AuthenticatedActor = { userId: delivery.ownerUserId };
    const notifResult = await options.notificationRepository.getNotification(
      ownerActor,
      delivery.notificationId,
    );
    const notification = notifResult.ok ? notifResult.value : null;

    if (!notification) {
      await options.deliveryRepository.updateDelivery(delivery.id, {
        status: "failed",
        lastErrorCode: "missing_notification",
        lastErrorReason: "Notification not found",
        attemptCount: delivery.attemptCount + 1,
        failedAt: nowIso,
        updatedAt: nowIso,
        nextAttemptAt: null,
      });
      counts.failed += 1;
      continue;
    }

    // Re-check current per-type opt-out immediately before dispatch. A failed
    // read must not be treated as "enabled"; defer without calling a provider.
    const prefsResult = await options.preferenceRepository.listPreferences(ownerActor);
    if (!prefsResult.ok) {
      const outcome = await deferDeliveryForInfrastructure({
        repository: options.deliveryRepository,
        delivery,
        code: "preferences_unavailable",
        reason: "Unable to read notification preferences before dispatch.",
        now,
        nowIso,
      });
      if (outcome === "retried") counts.retried += 1;
      else counts.failed += 1;
      continue;
    }
    const pref = prefsResult.value.find((p) => p.notificationType === notification.type) ?? null;
    // No stored row keeps the legacy enabled default; an explicit row controls
    // the channel.
    const channelEnabled = pref
      ? delivery.channel === "push"
        ? pref.pushEnabled
        : pref.emailEnabled
      : true;
    if (!channelEnabled) {
      await markSuppressed(
        options.deliveryRepository,
        delivery.id,
        "opt_out",
        "Channel disabled by owner preference.",
        nowIso,
      );
      counts.suppressed += 1;
      continue;
    }

    // Re-check current quiet hours; terminal recorded result, not a queue. A
    // read failure means we cannot know whether it is quiet, so defer.
    const quiet = await resolveQuietHoursSuppression({
      actor: ownerActor,
      notificationType: notification.type,
      settingsRepository: options.settingsRepository,
      timeContextRepository: options.timeContextRepository,
      now,
    });
    if (quiet.status === "unavailable") {
      const outcome = await deferDeliveryForInfrastructure({
        repository: options.deliveryRepository,
        delivery,
        code: "quiet_hours_unavailable",
        reason: "Unable to read quiet-hours settings before dispatch.",
        now,
        nowIso,
      });
      if (outcome === "retried") counts.retried += 1;
      else counts.failed += 1;
      continue;
    }
    if (quiet.status === "quiet") {
      await markSuppressed(
        options.deliveryRepository,
        delivery.id,
        "quiet_hours",
        "Suppressed during owner quiet hours.",
        nowIso,
      );
      counts.suppressed += 1;
      continue;
    }

    if (delivery.channel === "push") {
      let token: string | null = null;
      if (delivery.deviceId) {
        const devices = await options.deviceRepository.listActiveDevices(ownerActor);
        if (devices.ok) {
          const device = devices.value.find((d) => d.id === delivery.deviceId);
          token = device?.providerToken ?? null;
        }
      }

      if (!token) {
        await options.deliveryRepository.updateDelivery(delivery.id, {
          status: "invalid_endpoint",
          lastErrorCode: "missing_token",
          lastErrorReason: "Device token not found or device inactive",
          failedAt: nowIso,
          updatedAt: nowIso,
          nextAttemptAt: null,
        });
        counts.invalidated += 1;
        continue;
      }

      const pushResult = await options.pushProvider.send({
        token,
        title: notification.title,
        body: notification.body,
        data: buildPushDataPayload({
          notificationId: delivery.notificationId,
          type: notification.type,
          targetType: notification.targetType,
          targetId: notification.targetId,
        }),
      });

      if (pushResult.ok) {
        await options.deliveryRepository.updateDelivery(delivery.id, {
          status: "provider_accepted",
          providerMessageId: pushResult.providerMessageId,
          attemptCount: delivery.attemptCount + 1,
          providerAcceptedAt: nowIso,
          updatedAt: nowIso,
          nextAttemptAt: null,
          lastErrorCode: null,
          lastErrorReason: null,
        });
        counts.accepted += 1;
      } else {
        const classification = pushResult.errorCode;
        if (classification === "invalid_endpoint") {
          await options.deliveryRepository.updateDelivery(delivery.id, {
            status: "invalid_endpoint",
            lastErrorCode: pushResult.errorCode,
            lastErrorReason: pushResult.errorReason,
            attemptCount: delivery.attemptCount + 1,
            failedAt: nowIso,
            updatedAt: nowIso,
            nextAttemptAt: null,
          });
          counts.invalidated += 1;
          await options.deviceRepository.deactivateByToken(delivery.ownerUserId, token);
        } else if (classification === "transient") {
          const nextAttempt = nextRetryAt(delivery.attemptCount + 1, now);
          if (!nextAttempt) {
            await options.deliveryRepository.updateDelivery(delivery.id, {
              status: "failed",
              lastErrorCode: pushResult.errorCode,
              lastErrorReason: pushResult.errorReason,
              attemptCount: delivery.attemptCount + 1,
              failedAt: nowIso,
              updatedAt: nowIso,
              nextAttemptAt: null,
            });
            counts.failed += 1;
          } else {
            await options.deliveryRepository.updateDelivery(delivery.id, {
              status: "retry_scheduled",
              lastErrorCode: pushResult.errorCode,
              lastErrorReason: pushResult.errorReason,
              attemptCount: delivery.attemptCount + 1,
              nextAttemptAt: nextAttempt,
              updatedAt: nowIso,
            });
            counts.retried += 1;
          }
        } else {
          await options.deliveryRepository.updateDelivery(delivery.id, {
            status: "failed",
            lastErrorCode: pushResult.errorCode,
            lastErrorReason: pushResult.errorReason,
            attemptCount: delivery.attemptCount + 1,
            failedAt: nowIso,
            updatedAt: nowIso,
            nextAttemptAt: null,
          });
          counts.failed += 1;
        }
      }
      continue;
    }

    // Email channel
    const to = await options.emailResolver.resolve(delivery.ownerUserId);
    if (!to) {
      await options.deliveryRepository.updateDelivery(delivery.id, {
        status: "failed",
        lastErrorCode: "missing_destination",
        lastErrorReason: "Email destination not found",
        attemptCount: delivery.attemptCount + 1,
        failedAt: nowIso,
        updatedAt: nowIso,
        nextAttemptAt: null,
      });
      counts.failed += 1;
      continue;
    }

    const subject = notification.title;
    const html = `<p>${notification.body ?? ""}</p><p><a href="https://www.egawilldoit.online/notifications">Open EGA House</a></p>`;
    const emailResult = await options.emailProvider.send({ to, subject, html });

    if (emailResult.ok) {
      await options.deliveryRepository.updateDelivery(delivery.id, {
        status: "provider_accepted",
        providerMessageId: emailResult.providerMessageId ?? null,
        attemptCount: delivery.attemptCount + 1,
        providerAcceptedAt: nowIso,
        updatedAt: nowIso,
        nextAttemptAt: null,
        lastErrorCode: null,
        lastErrorReason: null,
      });
      counts.accepted += 1;
    } else if (emailResult.errorCode === "transient") {
      const nextAttempt = nextRetryAt(delivery.attemptCount + 1, now);
      if (!nextAttempt) {
        await options.deliveryRepository.updateDelivery(delivery.id, {
          status: "failed",
          lastErrorCode: emailResult.errorCode,
          lastErrorReason: emailResult.errorReason,
          attemptCount: delivery.attemptCount + 1,
          failedAt: nowIso,
          updatedAt: nowIso,
          nextAttemptAt: null,
        });
        counts.failed += 1;
      } else {
        await options.deliveryRepository.updateDelivery(delivery.id, {
          status: "retry_scheduled",
          lastErrorCode: emailResult.errorCode,
          lastErrorReason: emailResult.errorReason,
          attemptCount: delivery.attemptCount + 1,
          nextAttemptAt: nextAttempt,
          updatedAt: nowIso,
        });
        counts.retried += 1;
      }
    } else {
      await options.deliveryRepository.updateDelivery(delivery.id, {
        status: "failed",
        lastErrorCode: emailResult.errorCode,
        lastErrorReason: emailResult.errorReason,
        attemptCount: delivery.attemptCount + 1,
        failedAt: nowIso,
        updatedAt: nowIso,
        nextAttemptAt: null,
      });
      counts.failed += 1;
    }
  }

  return applicationSuccess(counts);
}
