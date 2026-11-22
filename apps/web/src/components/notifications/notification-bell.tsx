"use client";

import { Bell, CheckCheck, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useCanonicalUrl } from "@/lib/use-canonical-url";

import {
  loadNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  openNotificationAction,
} from "./notification-actions";
import type { NotificationBellRow } from "./notification-bell-types";

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/**
 * Top-bar notification history.
 *
 * The retired `/notifications` page is replaced by this popover: it refreshes
 * the first page on every open, pages older notifications with the stored
 * cursor and mutates read state through the canonical owner-scoped service. The
 * unread count mirrors the server prop so an account switch cannot keep a stale
 * badge.
 */
export function NotificationBell({ initialUnreadCount }: { initialUnreadCount: number }) {
  const canonicalUrl = useCanonicalUrl();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NotificationBellRow[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [draftCount, setDraftCount] = useState<{
    base: number;
    value: number;
  } | null>(null);
  const unreadCount =
    draftCount && draftCount.base === initialUnreadCount
      ? draftCount.value
      : initialUnreadCount;
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Every open starts a refresh; the ref keeps a rapid close/reopen or a page
  // load from firing overlapping requests for the same first page.
  const loadingRef = useRef(false);

  function updateUnreadCount(value: number) {
    setDraftCount({ base: initialUnreadCount, value });
  }

  // Installed-PWA app badge: the bell is always mounted, so it replaces the
  // retired notifications page as the one place that reconciles the badge.
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (unreadCount > 0) {
      if (typeof nav.setAppBadge === "function") {
        void nav.setAppBadge(unreadCount).catch(() => undefined);
      }
      return;
    }
    if (typeof nav.clearAppBadge === "function") {
      void nav.clearAppBadge().catch(() => undefined);
    }
  }, [unreadCount]);

  const label =
    unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications";

  async function load(cursor: string | null, append: boolean) {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setPending(true);
    setErrorMessage(null);
    try {
      const result = await loadNotificationsAction(cursor);
      if (!result.ok) {
        setErrorMessage(result.errorMessage);
        return;
      }
      setRows((current) => (append && current ? [...current, ...result.rows] : result.rows));
      updateUnreadCount(result.unreadCount);
      setNextCursor(result.nextCursor);
    } catch {
      setErrorMessage("Unable to load notifications right now.");
    } finally {
      loadingRef.current = false;
      setPending(false);
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // A prior in-flight or aborted refresh must never block a fresh open
      // from loading the first page; reset the guard so the seeded/changed
      // notification is always fetched.
      loadingRef.current = false;
      // Refresh the first page on every open so notifications created since the
      // last open appear; older pages still append from the new cursor.
      void load(null, false);
    }
  }

  async function markRead(row: NotificationBellRow) {
    setErrorMessage(null);
    try {
      const result = await markNotificationReadAction(row.id);
      if (!result.ok) {
        setErrorMessage(result.errorMessage);
        return;
      }
      setRows((current) =>
        current?.map((entry) =>
          entry.id === row.id ? { ...entry, isUnread: false } : entry,
        ) ?? current,
      );
      if (row.isUnread) updateUnreadCount(Math.max(0, unreadCount - 1));
    } catch {
      setErrorMessage("Unable to update notification right now.");
    }
  }

  async function openRow(row: NotificationBellRow) {
    setErrorMessage(null);
    try {
      const result = await openNotificationAction(row.id);
      if (!result.ok) {
        setErrorMessage(result.errorMessage);
        return;
      }
      setRows((current) =>
        current?.map((entry) =>
          entry.id === row.id ? { ...entry, isUnread: false } : entry,
        ) ?? current,
      );
      if (row.isUnread) updateUnreadCount(Math.max(0, unreadCount - 1));
      if (result.href) {
        setOpen(false);
        window.location.assign(canonicalUrl.resolve(result.href));
      }
    } catch {
      setErrorMessage("Unable to open notification right now.");
    }
  }

  async function markAllRead() {
    setErrorMessage(null);
    try {
      const result = await markAllNotificationsReadAction();
      if (!result.ok) {
        setErrorMessage(result.errorMessage);
        return;
      }
      setRows((current) =>
        current?.map((entry) => ({ ...entry, isUnread: false })) ?? current,
      );
      updateUnreadCount(0);
    } catch {
      setErrorMessage("Unable to update notifications right now.");
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="topbar-icon-button topbar-notification"
          aria-label={label}
          title={label}
          data-has-unread={unreadCount > 0 ? "true" : "false"}
        >
          <Bell aria-hidden="true" />
          {unreadCount > 0 ? <span className="notification-dot" aria-hidden="true" /> : null}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        role="dialog"
        className="w-[min(24rem,calc(100vw-1rem))] p-0"
        aria-label="Notifications"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--ega-divider)] px-4 py-3">
          <div>
            <p className="text-[length:var(--text-body)] font-semibold">Notifications</p>
            <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
              {unreadCount > 0
                ? `${unreadCount} unread reminder${unreadCount === 1 ? "" : "s"}`
                : "You are caught up."}
            </p>
          </div>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={() => void markAllRead()}
              disabled={pending}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-[length:var(--text-meta)] font-medium text-[color:var(--ega-text-secondary)] hover:bg-[var(--ega-surface-hover)] hover:text-[color:var(--ega-text)]"
            >
              <CheckCheck className="h-4 w-4" aria-hidden="true" />
              Mark all read
            </button>
          ) : null}
        </div>

        {errorMessage ? (
          <p role="alert" className="border-b border-[var(--ega-divider)] px-4 py-2 text-[length:var(--text-meta)] text-[color:var(--status-overdue)]">
            {errorMessage}
          </p>
        ) : null}

        {rows === null && pending ? (
          <p role="status" className="px-4 py-6 text-center text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Loading notifications…
          </p>
        ) : null}

        {rows !== null && rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            No notifications yet. Task reminders will appear here.
          </p>
        ) : null}

        {rows !== null && rows.length > 0 ? (
          <ul className="max-h-[min(60vh,26rem)] overflow-y-auto">
            {rows.map((row) => (
              <li
                key={row.id}
                className={cn(
                  "border-b border-[var(--ega-divider)] px-4 py-3 last:border-b-0",
                  row.isUnread && "bg-[var(--ega-surface-subtle)]",
                )}
              >
                <div className="flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                      row.isUnread ? "bg-[color:var(--status-info)]" : "bg-transparent",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-[length:var(--text-body)]", row.isUnread && "font-semibold")}>
                      <span>{row.title}</span>
                      {row.isUnread ? <span className="sr-only"> Unread</span> : null}
                    </p>
                    {row.body ? (
                      <p className="mt-0.5 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                        {row.body}
                      </p>
                    ) : null}
                    <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
                      <time dateTime={row.createdAt}>{formatCreatedAt(row.createdAt)}</time>
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {row.targetHref ? (
                        <button
                          type="button"
                          onClick={() => void openRow(row)}
                          className="inline-flex min-h-8 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--ega-border)] px-2 text-[length:var(--text-meta)] font-medium hover:bg-[var(--ega-surface-hover)]"
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                          Open
                        </button>
                      ) : null}
                      {row.isUnread ? (
                        <button
                          type="button"
                          onClick={() => void markRead(row)}
                          className="inline-flex min-h-8 items-center rounded-[var(--radius-sm)] px-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)] underline-offset-2 hover:underline"
                        >
                          Mark read
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {nextCursor ? (
          <div className="border-t border-[var(--ega-divider)] p-2">
            <button
              type="button"
              onClick={() => void load(nextCursor, true)}
              disabled={pending}
              className="w-full rounded-[var(--radius-sm)] px-2 py-2 text-[length:var(--text-meta)] font-medium text-[color:var(--ega-text-secondary)] hover:bg-[var(--ega-surface-hover)] hover:text-[color:var(--ega-text)] disabled:opacity-50"
            >
              {pending ? "Loading…" : "Load older notifications"}
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
