import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import type { Metadata } from "next";
import Link from "next/link";
import { CheckCheck } from "lucide-react";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import {
  getWebNotifications,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/app/(workspace)/notifications/actions";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import { formatRelativeTime } from "@/lib/presentation-format";

export const metadata: Metadata = {
  title: "Notifications",
  description: "Updates and reminders that need your attention.",
};

type NotificationsPageProps = {
  searchParams: Promise<{
    cursor?: string;
    notice?: string;
    error?: string;
  }>;
};

type GroupKey = "today" | "thisWeek" | "earlier";

function getGroupForDate(date: Date, now: Date) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfToday);
  const day = startOfWeek.getDay();
  const diffToMonday = (day + 6) % 7;
  startOfWeek.setDate(startOfWeek.getDate() - diffToMonday);

  if (date >= startOfToday) {
    return "today" satisfies GroupKey;
  }
  if (date >= startOfWeek) {
    return "thisWeek" satisfies GroupKey;
  }
  return "earlier" satisfies GroupKey;
}

function buildNotificationGroups(
  notifications: Awaited<ReturnType<typeof getWebNotifications>>["data"]["notifications"],
  timezone?: string,
) {
  const now = new Date();
  const groups: Record<GroupKey, typeof notifications> = {
    today: [],
    thisWeek: [],
    earlier: [],
  };

  for (const notification of notifications) {
    const createdAt = new Date(notification.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      groups.earlier.push(notification);
      continue;
    }
    const key = getGroupForDate(createdAt, now);
    groups[key].push(notification);
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
      <>
        <WorkspacePageHeader title="Notifications" description="Updates and reminders that need your attention." />
        {notice ? (
          <div className="feedback-block mb-5" role="status" aria-live="polite">
            {notice}
          </div>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>Notifications unavailable</CardTitle>
            <CardDescription>
              {error ?? result.errorMessage ?? "Unable to load notifications right now."}
            </CardDescription>
          </CardHeader>
          <div className="px-[18px] py-4">
            <Link href="/notifications" className="btn-instrument btn-instrument-muted inline-flex h-8 items-center px-3 text-xs">
              Try again
            </Link>
          </div>
        </Card>
      </>
    );
  }

  const { notifications, unreadCount, nextCursor } = result.data;
  const timeContext = await getWebTimeContext().catch(() => null);
  const groups = buildNotificationGroups(notifications, timeContext?.timezone);

  return (
    <>
      <WorkspacePageHeader
        title="Notifications"
        description="Updates and reminders that need your attention."
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
      />
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
      {notifications.length === 0 ? (
        <EmptyState
          title="You're all caught up"
          description="New notifications will appear here when there's something to review."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {(Object.keys(groups) as GroupKey[]).map((groupKey) => {
            const group = groups[groupKey];
            if (group.length === 0) {
              return null;
            }
            const label =
              groupKey === "today" ? "Today" : groupKey === "thisWeek" ? "This week" : "Earlier";
            return (
              <section key={groupKey} className="flex flex-col gap-3">
                <h2 className="text-sm font-medium text-[color:var(--ega-text-secondary)]">{label}</h2>
                <div className="flex flex-col divide-y divide-[color:var(--ega-border-subtle)] overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--ega-border-subtle)] bg-[color:var(--ega-surface-panel)]">
                  {group.map((notification) => (
                    <article
                      key={notification.id}
                      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <p className="text-[length:var(--text-body)] font-medium">
                            {notification.title}
                          </p>
                          {!notification.readAt ? (
                            <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--ega-accent)]" aria-label="Unread" />
                          ) : null}
                        </div>
                        {notification.body ? (
                          <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                            {notification.body}
                          </p>
                        ) : null}
                        <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
                          {formatRelativeTime(notification.createdAt, timeContext?.timezone)}
                        </p>
                      </div>
                      {!notification.readAt ? (
                        <form action={markNotificationReadAction}>
                          <input type="hidden" name="notificationId" value={notification.id} />
                          <input type="hidden" name="returnTo" value="/notifications" />
                          <PendingSubmitButton type="submit" size="sm" variant="muted">
                            Mark read
                          </PendingSubmitButton>
                        </form>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {nextCursor ? (
        <div className="mt-6">
          <Link
            href={`/notifications?cursor=${encodeURIComponent(nextCursor)}`}
            className="btn-instrument btn-instrument-muted inline-flex h-9 items-center px-4 text-sm"
          >
            Load more
          </Link>
        </div>
      ) : null}
    </>
  );
}
