import type { Metadata } from "next";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import type { Notification } from "@ega/contracts";

import {
  markAllNotificationsReadAction,
} from "./actions";
import {
  NotificationsInbox,
  type NotificationInboxGroup,
  type NotificationInboxRow,
} from "./notifications-inbox";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { getWebNotifications } from "@/lib/services/notification-service";
import { getNotificationTargetHref } from "@/lib/notification-target";

export const metadata: Metadata = {
  title: "Notifications",
  description: "Review task reminders and return to the work they reference.",
};

export const dynamic = "force-dynamic";

type NotificationsPageProps = {
  searchParams: Promise<{
    cursor?: string;
    error?: string;
    notice?: string;
  }>;
};

function formatNotificationDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatNotificationDayHeading(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfDay) / 86_400_000);

  if (dayDiff === 0) {
    return "Today";
  }
  if (dayDiff === 1) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(date);
}

function buildNotificationGroups(notifications: Notification[]): NotificationInboxGroup[] {
  const groups: NotificationInboxGroup[] = [];

  for (const notification of notifications) {
    const createdAt = new Date(notification.createdAt);
    const key = Number.isNaN(createdAt.getTime())
      ? "unknown"
      : createdAt.toISOString().slice(0, 10);

    const row: NotificationInboxRow = {
      id: notification.id,
      title: notification.title,
      body: notification.body,
      createdAt: notification.createdAt,
      createdAtLabel: formatNotificationDate(notification.createdAt),
      targetHref: notification.target
        ? getNotificationTargetHref(notification.target)
        : null,
      isUnread: !notification.readAt,
    };

    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.key === key) {
      lastGroup.rows.push(row);
    } else {
      groups.push({
        key,
        label: formatNotificationDayHeading(notification.createdAt),
        rows: [row],
      });
    }
  }

  return groups;
}

function getFeedbackMessage(value: string | undefined) {
  return value?.trim().slice(0, 180) || null;
}

export default async function NotificationsPage({ searchParams }: NotificationsPageProps) {
  const params = await searchParams;
  const result = await getWebNotifications({
    limit: 25,
    cursor: params.cursor?.trim() || null,
  });
  const notice = getFeedbackMessage(params.notice);
  const error = getFeedbackMessage(params.error);

  if (result.errorMessage || !result.data) {
    return (
      <AppShell
        title="Notifications"
        description="Review reminders and return to the work they reference."
      >
        {notice ? (
          <div className="feedback-block mb-5" role="status" aria-live="polite">
            {notice}
          </div>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>Notifications unavailable</CardTitle>
            <CardDescription>{error ?? result.errorMessage ?? "Unable to load notifications right now."}</CardDescription>
          </CardHeader>
          <div className="px-[18px] py-4">
            <Link href="/notifications" className="btn-instrument btn-instrument-muted inline-flex h-8 items-center px-3 text-xs">
              Try again
            </Link>
          </div>
        </Card>
      </AppShell>
    );
  }

  const { notifications, unreadCount, nextCursor } = result.data;
  const groups = buildNotificationGroups(notifications);

  return (
    <AppShell
      title="Notifications"
      description="Review reminders and return to the work they reference."
      actions={
        unreadCount > 0 ? (
          <form action={markAllNotificationsReadAction}>
            <PendingSubmitButton
              type="submit"
              size="sm"
              variant="muted"
              className="gap-2"
              pendingLabel="Marking all..."
            >
              <CheckCheck className="h-4 w-4" aria-hidden="true" />
              Mark all read
            </PendingSubmitButton>
          </form>
        ) : null
      }
    >
      {notice ? (
        <div className="feedback-block mb-5" role="status" aria-live="polite">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="feedback-block feedback-block-error mb-5" role="alert">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle>Notification history</CardTitle>
              <CardDescription>
                {unreadCount > 0
                  ? `${unreadCount} unread reminder${unreadCount === 1 ? "" : "s"} need your attention.`
                  : "You are caught up. New task reminders will appear here."}
              </CardDescription>
            </div>
            <Badge tone={unreadCount > 0 ? "warn" : "active"}>
              {unreadCount} unread
            </Badge>
          </div>
        </CardHeader>

        {notifications.length > 0 ? (
          <>
            <NotificationsInbox groups={groups} unreadCount={unreadCount} />
            {nextCursor ? (
              <div className="flex justify-center border-t border-[var(--ega-divider)] px-[18px] py-4">
                <Link
                  href={`/notifications?cursor=${encodeURIComponent(nextCursor)}`}
                  className="btn-instrument btn-instrument-muted inline-flex h-8 items-center px-3 text-xs"
                >
                  Load older notifications
                </Link>
              </div>
            ) : null}
          </>
        ) : (
          <EmptyState
            icon={Bell}
            title="No notifications yet"
            description="Task reminders will stay here until you have reviewed them."
          />
        )}
      </Card>
    </AppShell>
  );
}
