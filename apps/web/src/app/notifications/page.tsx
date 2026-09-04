import type { Metadata } from "next";
import Link from "next/link";
import { Bell, CheckCheck, ExternalLink } from "lucide-react";
import type { Notification } from "@ega/contracts";

import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
  openNotificationAction,
} from "./actions";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { getWebNotifications } from "@/lib/services/notification-service";
import { cn } from "@/lib/utils";

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

function getFeedbackMessage(value: string | undefined) {
  return value?.trim().slice(0, 180) || null;
}

function NotificationCard({
  notification,
}: {
  notification: Notification;
}) {
  const isUnread = !notification.readAt;

  return (
    <li>
      <article
        className={cn(
          "ega-glass rounded-[1.25rem] border p-5 transition-shadow hover:shadow-[var(--shadow-card-hover)]",
          isUnread
            ? "border-[rgba(198,40,40,0.2)] bg-white"
            : "border-[var(--border)] bg-white/70",
        )}
        aria-labelledby={`notification-${notification.id}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={isUnread ? "warn" : "muted"}>{isUnread ? "Unread" : "Read"}</Badge>
            <span className="glass-label text-etch">Task reminder</span>
          </div>
          <time
            dateTime={notification.createdAt}
            className="text-xs text-[color:var(--muted-foreground)]"
          >
            {formatNotificationDate(notification.createdAt)}
          </time>
        </div>

        <h2
          id={`notification-${notification.id}`}
          className="mt-4 text-base font-semibold text-[color:var(--foreground)]"
        >
          {notification.title}
        </h2>
        {notification.body ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--muted-foreground)]">
            {notification.body}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {notification.target ? (
            <form action={openNotificationAction}>
              <input type="hidden" name="notificationId" value={notification.id} />
              <PendingSubmitButton
                type="submit"
                size="sm"
                className="gap-2"
                pendingLabel="Opening..."
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                Open task
              </PendingSubmitButton>
            </form>
          ) : null}
          {isUnread ? (
            <form action={markNotificationReadAction}>
              <input type="hidden" name="notificationId" value={notification.id} />
              <PendingSubmitButton
                type="submit"
                size="sm"
                variant="muted"
                pendingLabel="Updating..."
              >
                Mark read
              </PendingSubmitButton>
            </form>
          ) : null}
        </div>
      </article>
    </li>
  );
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
        eyebrow="System"
        title="Notifications"
        description="Review reminders and return to the work they reference."
      >
        {notice ? (
          <div className="feedback-block feedback-block-success mb-5" role="status" aria-live="polite">
            {notice}
          </div>
        ) : null}
        <Card className="border-[rgba(198,40,40,0.2)] bg-white">
          <CardHeader>
            <CardTitle>Notifications unavailable</CardTitle>
            <CardDescription>{error ?? result.errorMessage ?? "Unable to load notifications right now."}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/notifications" className="btn-instrument btn-instrument-muted inline-flex h-9 items-center px-4 text-sm">
              Try again
            </Link>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const { notifications, unreadCount, nextCursor } = result.data;

  return (
    <AppShell
      eyebrow="System"
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
        <div className="feedback-block feedback-block-success mb-5" role="status" aria-live="polite">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="feedback-block feedback-block-error mb-5" role="alert">
          {error}
        </div>
      ) : null}

      <Card className="border-[var(--border)] bg-white/80">
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
        <CardContent>
          {notifications.length > 0 ? (
            <>
              <ul className="space-y-3" aria-label="Notification history">
                {notifications.map((notification) => (
                  <NotificationCard key={notification.id} notification={notification} />
                ))}
              </ul>
              {nextCursor ? (
                <div className="mt-5 flex justify-center">
                  <Link
                    href={`/notifications?cursor=${encodeURIComponent(nextCursor)}`}
                    className="btn-instrument btn-instrument-muted inline-flex h-9 items-center px-4 text-sm"
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
        </CardContent>
      </Card>
    </AppShell>
  );
}
