"use server";

import {
  getWebNotifications,
  markAllWebNotificationsRead,
  markWebNotificationOpened,
  markWebNotificationRead,
} from "@/lib/services/notification-service";
import { getNotificationTargetHref } from "@/lib/notification-target";
import type {
  NotificationMutationResult,
  NotificationOpenResult,
  NotificationPageResult,
  NotificationReadAllResult,
} from "@/components/notifications/notification-bell-types";

const PAGE_SIZE = 12;

export async function loadNotificationsAction(
  cursor: string | null,
): Promise<NotificationPageResult> {
  const result = await getWebNotifications({
    limit: PAGE_SIZE,
    cursor: cursor?.trim() || null,
  });

  if (result.errorMessage || !result.data) {
    return {
      ok: false,
      errorMessage: result.errorMessage ?? "Unable to load notifications right now.",
    };
  }

  return {
    ok: true,
    rows: result.data.notifications.map((notification) => ({
      id: notification.id,
      title: notification.title,
      body: notification.body,
      createdAt: notification.createdAt,
      targetHref: getNotificationTargetHref(notification.target),
      isUnread: !notification.readAt,
    })),
    unreadCount: result.data.unreadCount,
    nextCursor: result.data.nextCursor,
  };
}

export async function markNotificationReadAction(
  notificationId: string,
): Promise<NotificationMutationResult> {
  const result = await markWebNotificationRead(notificationId);
  if (result.errorMessage || !result.data) {
    return {
      ok: false,
      errorMessage: result.errorMessage ?? "Unable to update notification right now.",
    };
  }
  return { ok: true };
}

export async function openNotificationAction(
  notificationId: string,
): Promise<NotificationOpenResult> {
  const result = await markWebNotificationOpened(notificationId);
  if (result.errorMessage || !result.data) {
    return {
      ok: false,
      errorMessage: result.errorMessage ?? "Notification not found.",
    };
  }
  return {
    ok: true,
    href: getNotificationTargetHref(result.data.target),
  };
}

export async function markAllNotificationsReadAction(): Promise<NotificationReadAllResult> {
  const result = await markAllWebNotificationsRead();
  if (result.errorMessage || !result.data) {
    return {
      ok: false,
      errorMessage: result.errorMessage ?? "Unable to update notifications right now.",
    };
  }
  return { ok: true, updatedCount: result.data.updatedCount };
}
