import {
  createAuthenticatedActor,
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationOpened,
  markNotificationRead,
  type ApplicationResult,
  type NotificationRecord,
} from "@ega/application";
import { SupabaseNotificationRepository } from "@ega/data-access/notifications";
import type { Notification } from "@ega/contracts";

import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedUser } from "@/lib/services/auth-service";

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

function mapNotification(record: NotificationRecord): Notification {
  return {
    id: record.id,
    type: record.type,
    title: record.title,
    body: record.body,
    target:
      record.targetType === "task" && record.targetId
        ? { type: "task", id: record.targetId }
        : null,
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
