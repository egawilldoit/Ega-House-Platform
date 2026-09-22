"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, ExternalLink } from "lucide-react";

import {
  markNotificationReadAction,
  openNotificationAction,
} from "./actions";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterPill } from "@/components/ui/filter-pill";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { cn } from "@/lib/utils";

export type NotificationInboxRow = {
  id: string;
  title: string;
  body: string | null;
  createdAt: string;
  createdAtLabel: string;
  targetHref: string | null;
  isUnread: boolean;
};

export type NotificationInboxGroup = {
  key: string;
  label: string;
  rows: NotificationInboxRow[];
};

type NotificationInboxView = "all" | "unread";

function NotificationRow({ row }: { row: NotificationInboxRow }) {
  return (
    <li className="row items-start">
      <span
        aria-hidden="true"
        className={cn(
          "mt-2 h-1.5 w-1.5 shrink-0 rounded-full",
          row.isUnread ? "bg-[color:var(--ega-ink)]" : "bg-transparent",
        )}
      />

      <div className="row-main">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {row.targetHref ? (
            <Link
              href={row.targetHref}
              className={cn("row-title hover:underline", row.isUnread && "font-semibold")}
            >
              {row.title}
            </Link>
          ) : (
            <span className={cn("row-title", row.isUnread && "font-semibold")}>
              {row.title}
            </span>
          )}
          {row.isUnread ? <span className="sr-only">Unread</span> : null}
          <time
            dateTime={row.createdAt}
            className="text-[length:var(--text-meta)] tabular-nums text-[color:var(--ega-text-tertiary)]"
          >
            {row.createdAtLabel}
          </time>
        </div>

        {row.body ? (
          <p className="text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-[color:var(--ega-text-secondary)]">
            {row.body}
          </p>
        ) : null}

        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {row.targetHref ? (
            <form action={openNotificationAction}>
              <input type="hidden" name="notificationId" value={row.id} />
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

          {row.isUnread ? (
            <form action={markNotificationReadAction}>
              <input type="hidden" name="notificationId" value={row.id} />
              <PendingSubmitButton
                type="submit"
                size="sm"
                variant="muted"
                aria-label={`Mark "${row.title}" as read`}
                pendingLabel="Updating..."
              >
                Mark read
              </PendingSubmitButton>
            </form>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function NotificationsInbox({
  groups,
  unreadCount,
}: {
  groups: NotificationInboxGroup[];
  unreadCount: number;
}) {
  const [view, setView] = useState<NotificationInboxView>("all");

  const visibleGroups = groups
    .map((group) => ({
      ...group,
      rows: view === "unread" ? group.rows.filter((row) => row.isUnread) : group.rows,
    }))
    .filter((group) => group.rows.length > 0);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ega-divider)] px-[18px] py-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Notification views">
          <FilterPill
            label="All"
            onClick={() => setView("all")}
            active={view === "all"}
          />
          <FilterPill
            label="Unread"
            onClick={() => setView("unread")}
            active={view === "unread"}
          />
        </div>
      </div>

      {visibleGroups.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={
            view === "unread" && unreadCount > 0
              ? "No unread notifications on this page"
              : view === "unread"
                ? "No unread notifications"
                : "No notifications in this view"
          }
          description={
            view === "unread" && unreadCount > 0
              ? "Older unread reminders may still be waiting. Load older notifications to keep going."
              : view === "unread"
                ? "You are caught up. New task reminders will appear here."
                : "Nothing to show here yet."
          }
        />
      ) : (
        visibleGroups.map((group) => (
          <section key={group.key} aria-labelledby={`notification-group-${group.key}`}>
            <h3
              id={`notification-group-${group.key}`}
              className="glass-label border-b border-[var(--ega-divider)] bg-[color:var(--ega-surface-subtle)] px-[18px] py-2"
            >
              {group.label}
            </h3>
            <ul className="rows" aria-label={group.label}>
              {group.rows.map((row) => (
                <NotificationRow key={row.id} row={row} />
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
