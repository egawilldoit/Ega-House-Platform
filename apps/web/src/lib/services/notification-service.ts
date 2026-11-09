import {
  createAuthenticatedActor,
  getNotificationPreferences,
  getNotificationSettings,
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationOpened,
  markNotificationRead,
  updateNotificationPreferences,
  updateNotificationSettings,
  type ApplicationResult,
  type NotificationRecord,
} from "@ega/application";
import {
  SupabaseNotificationPreferenceRepository,
  SupabaseNotificationRepository,
  SupabaseNotificationSettingsRepository,
} from "@ega/data-access/notifications";
import { SupabaseTimeContextRepository } from "@ega/data-access";
import { isNotificationTargetType, type Notification, type NotificationPreferences, type NotificationSettings, type NotificationTarget } from "@ega/contracts";

import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedUser } from "@/lib/services/auth-service";
import { getRequestTimeContextRepository } from "@/lib/request-time-context";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type NotificationContext = {
  actor: ReturnType<typeof createAuthenticatedActor>;
  repository: SupabaseNotificationRepository;
};

type NotificationServiceOptions = {
  supabase?: SupabaseServerClient;
};

export type WebNotificationsData = {
  notifications: Notification[];
  unreadCount: number;
  nextCursor: string | null;
};

export type WebNotificationResult<T> = {
  data: T | null;
  errorMessage: string | null;
};

function mapTarget(record: NotificationRecord): NotificationTarget | null {
  if (!record.targetType || !isNotificationTargetType(record.targetType)) return null;
  if (record.targetType === "review" || record.targetType === "today") {
    return { type: record.targetType, id: null };
  }
  if (!record.targetId) return null;
  return { type: record.targetType, id: record.targetId };
}

function mapNotification(record: NotificationRecord): Notification {
  return {
    id: record.id,
    type: record.type,
    title: record.title,
    body: record.body,
    target: mapTarget(record),
    readAt: record.readAt,
    openedAt: record.openedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

async function getNotificationContext(
  options?: NotificationServiceOptions,
): Promise<{ context: NotificationContext; errorMessage: null } | { context: null; errorMessage: string }> {
  const supabase = options?.supabase ?? (await createClient());

  try {
    const user = await requireAuthenticatedUser({ supabase });
    return {
      context: {
        actor: createAuthenticatedActor(user.id),
        repository: new SupabaseNotificationRepository(supabase as never),
      },
      errorMessage: null,
    };
  } catch {
    return { context: null, errorMessage: "Authentication required." };
  }
}

function getApplicationError<T>(result: ApplicationResult<T>) {
  return result.ok ? null : result.errorMessage;
}

export async function getWebNotifications(options?: NotificationServiceOptions & {
  limit?: number;
  cursor?: string | null;
}): Promise<WebNotificationResult<WebNotificationsData>> {
  const contextResult = await getNotificationContext(options);
  if (!contextResult.context) {
    return { data: null, errorMessage: contextResult.errorMessage };
  }

  try {
    const [notificationsResult, unreadResult] = await Promise.all([
      listNotifications(contextResult.context.actor, contextResult.context.repository, {
        limit: options?.limit,
        cursor: options?.cursor ?? null,
      }),
      getUnreadCount(contextResult.context.actor, contextResult.context.repository),
    ]);

    const errorMessage = getApplicationError(notificationsResult) ?? getApplicationError(unreadResult);
    if (errorMessage || !notificationsResult.ok || !unreadResult.ok) {
      return { data: null, errorMessage: errorMessage ?? "Unable to load notifications right now." };
    }

    return {
      data: {
        notifications: notificationsResult.data.notifications.map(mapNotification),
        unreadCount: unreadResult.data.unreadCount,
        nextCursor: notificationsResult.data.nextCursor,
      },
      errorMessage: null,
    };
  } catch {
    return { data: null, errorMessage: "Unable to load notifications right now." };
  }
}

export async function markWebNotificationRead(
  notificationId: string,
  options?: NotificationServiceOptions,
): Promise<WebNotificationResult<Notification>> {
  const contextResult = await getNotificationContext(options);
  if (!contextResult.context) {
    return { data: null, errorMessage: contextResult.errorMessage };
  }

  try {
    const result = await markNotificationRead(
      contextResult.context.actor,
      contextResult.context.repository,
      notificationId,
    );
    if (!result.ok) {
      return { data: null, errorMessage: result.errorMessage };
    }

    return { data: mapNotification(result.data), errorMessage: null };
  } catch {
    return { data: null, errorMessage: "Unable to update notification right now." };
  }
}

export async function markWebNotificationOpened(
  notificationId: string,
  options?: NotificationServiceOptions,
): Promise<WebNotificationResult<Notification>> {
  const contextResult = await getNotificationContext(options);
  if (!contextResult.context) {
    return { data: null, errorMessage: contextResult.errorMessage };
  }

  try {
    const result = await markNotificationOpened(
      contextResult.context.actor,
      contextResult.context.repository,
      notificationId,
    );
    if (!result.ok) {
      return { data: null, errorMessage: result.errorMessage };
    }

    return { data: mapNotification(result.data), errorMessage: null };
  } catch {
    return { data: null, errorMessage: "Unable to update notification right now." };
  }
}

export async function markAllWebNotificationsRead(
  options?: NotificationServiceOptions,
): Promise<WebNotificationResult<{ updatedCount: number }>> {
  const contextResult = await getNotificationContext(options);
  if (!contextResult.context) {
    return { data: null, errorMessage: contextResult.errorMessage };
  }

  try {
    const result = await markAllNotificationsRead(
      contextResult.context.actor,
      contextResult.context.repository,
    );
    if (!result.ok) {
      return { data: null, errorMessage: result.errorMessage };
    }

    return { data: result.data, errorMessage: null };
  } catch {
    return { data: null, errorMessage: "Unable to update notifications right now." };
  }
}

/**
 * Category/channel preferences + quiet-hours settings (PO-19, issue #357).
 * Reads/writes go through the existing canonical notification preference
 * stores; UI hiding alone would never change dispatch.
 */
export async function getWebNotificationPreferences(
  options?: NotificationServiceOptions,
): Promise<WebNotificationResult<NotificationPreferences[]>> {
  const supabase = options?.supabase ?? (await createClient());
  try {
    const user = await requireAuthenticatedUser({ supabase });
    const result = await getNotificationPreferences(
      createAuthenticatedActor(user.id),
      new SupabaseNotificationPreferenceRepository(supabase as never),
    );
    if (!result.ok) return { data: null, errorMessage: result.errorMessage };
    return { data: result.data, errorMessage: null };
  } catch {
    return { data: null, errorMessage: "Unable to load notification preferences right now." };
  }
}

export async function updateWebNotificationPreferences(
  input: { notificationType: NotificationPreferences["notificationType"]; pushEnabled?: boolean; emailEnabled?: boolean },
  options?: NotificationServiceOptions,
): Promise<WebNotificationResult<{ notificationType: NotificationPreferences["notificationType"]; pushEnabled: boolean; emailEnabled: boolean }>> {
  const supabase = options?.supabase ?? (await createClient());
  try {
    const user = await requireAuthenticatedUser({ supabase });
    const result = await updateNotificationPreferences(
      createAuthenticatedActor(user.id),
      new SupabaseNotificationPreferenceRepository(supabase as never),
      input,
    );
    if (!result.ok) return { data: null, errorMessage: result.errorMessage };
    return { data: result.data, errorMessage: null };
  } catch {
    return { data: null, errorMessage: "Unable to save notification preferences right now." };
  }
}

export async function getWebNotificationSettings(
  options?: NotificationServiceOptions,
): Promise<WebNotificationResult<NotificationSettings>> {
  const supabase = options?.supabase ?? (await createClient());
  try {
    const user = await requireAuthenticatedUser({ supabase });
    const result = await getNotificationSettings(
      createAuthenticatedActor(user.id),
      new SupabaseNotificationSettingsRepository(supabase as never),
    );
    if (!result.ok) return { data: null, errorMessage: result.errorMessage };
    return { data: result.data, errorMessage: null };
  } catch {
    return { data: null, errorMessage: "Unable to load notification settings right now." };
  }
}

export async function updateWebNotificationSettings(
  input: { quietHoursEnabled?: boolean; quietHoursStart?: string; quietHoursEnd?: string },
  options?: NotificationServiceOptions,
): Promise<WebNotificationResult<NotificationSettings>> {
  const supabase = options?.supabase ?? (await createClient());
  try {
    const user = await requireAuthenticatedUser({ supabase });
    const timeContextRepository = options?.supabase
      ? new SupabaseTimeContextRepository(supabase as never)
      : await getRequestTimeContextRepository();
    const result = await updateNotificationSettings(
      createAuthenticatedActor(user.id),
      new SupabaseNotificationSettingsRepository(supabase as never),
      timeContextRepository,
      input,
    );
    if (!result.ok) return { data: null, errorMessage: result.errorMessage };
    return { data: result.data, errorMessage: null };
  } catch {
    return { data: null, errorMessage: "Unable to save notification settings right now." };
  }
}
