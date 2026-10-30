"use client";

import { useState } from "react";
import { Bell, ExternalLink } from "lucide-react";

import {
  markNotificationReadAction,
  markNotificationsReadAction,
  openNotificationAction,
} from "./actions";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterPill } from "@/components/ui/filter-pill";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { cn } from "@/lib/utils";
import {
  filterNotificationGroups,
  toggleSelection,
  type NotificationInboxGroup,
  type NotificationInboxRow,
  type NotificationInboxView,
} from "@/lib/notification-inbox-model";

export type { NotificationInboxGroup, NotificationInboxRow };

function NotificationRow({
  row,
  selected,
  onToggle,
}: {
  row: NotificationInboxRow;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <li className="row items-start">
      <input
        type="checkbox"
        className="mt-2 h-4 w-4 shrink-0"
        checked={selected}
        onChange={() => onToggle(row.id)}
        aria-label={`Select "${row.title}"`}
      />
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
            // Opens through the canonical action so the read transition the row
            // shows is actually persisted; a plain link would leave it unread.
            <form action={openNotificationAction} className="contents">
              <input type="hidden" name="notificationId" value={row.id} />
              <button
                type="submit"
                className={cn(
                  "row-title text-left hover:underline",
                  row.isUnread && "font-semibold",
                )}
              >
                {row.title}
              </button>
            </form>
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
  const [selected, setSelected] = useState<string[]>([]);

  const visibleGroups = filterNotificationGroups(groups, view);
  const visibleRows = visibleGroups.flatMap((group) => group.rows);
  const visibleIds = visibleRows.map((row) => row.id);
  const visibleUnreadIds = visibleRows.filter((row) => row.isUnread).map((row) => row.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));
  const selectedCount = selected.length;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ega-divider)] px-[18px] py-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Notification views">
          <FilterPill label="All" onClick={() => setView("all")} active={view === "all"} />
          <FilterPill
            label={unreadCount > 0 ? `Unread (${unreadCount})` : "Unread"}
            onClick={() => setView("unread")}
            active={view === "unread"}
          />
          <FilterPill label="Read" onClick={() => setView("read")} active={view === "read"} />
        </div>
      </div>

      {visibleRows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--ega-divider)] px-[18px] py-2">
          <label className="flex items-center gap-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={allVisibleSelected}
              onChange={() =>
                setSelected(allVisibleSelected ? [] : Array.from(new Set([...selected, ...visibleIds])))
              }
              aria-label="Select all notifications on this page"
            />
            Select all
          </label>

          {selectedCount > 0 ? (
            <>
              <span role="status" className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                {selectedCount} selected
              </span>
              <form action={markNotificationsReadAction} className="flex items-center gap-2">
                {selected.map((id) => (
                  <input key={id} type="hidden" name="notificationIds" value={id} />
                ))}
                <PendingSubmitButton
                  type="submit"
                  size="sm"
                  variant="secondary"
                  pendingLabel="Marking read..."
                >
                  Mark selected read
                </PendingSubmitButton>
              </form>
              <button
                type="button"
                onClick={() => setSelected([])}
                className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)] underline-offset-2 hover:underline"
              >
                Clear selection
              </button>
            </>
          ) : null}

          {view === "unread" && visibleUnreadIds.length > 0 ? (
            <button
              type="button"
              onClick={() => setSelected(visibleUnreadIds)}
              className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)] underline-offset-2 hover:underline"
            >
              Select all unread
            </button>
          ) : null}
        </div>
      ) : null}

      {visibleGroups.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={
            view === "unread" && unreadCount > 0
              ? "No unread notifications on this page"
              : view === "unread"
                ? "No unread notifications"
                : view === "read"
                  ? "Nothing read yet"
                  : "No notifications in this view"
          }
          description={
            view === "unread" && unreadCount > 0
              ? "Older unread reminders may still be waiting. Load older notifications to keep going."
              : view === "unread"
                ? "You are caught up. New task reminders will appear here."
                : view === "read"
                  ? "Notifications you open or mark read collect here."
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
                <NotificationRow
                  key={row.id}
                  row={row}
                  selected={selected.includes(row.id)}
                  onToggle={(id) => setSelected((current) => toggleSelection(current, id))}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
