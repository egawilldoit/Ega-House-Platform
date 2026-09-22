"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

import type { ShellIdentity, WorkspaceShellMetrics } from "@/lib/workspace-shell";
import { useCanonicalUrl } from "@/lib/use-canonical-url";

type TopBarProps = {
  metrics: WorkspaceShellMetrics;
  identity: ShellIdentity;
  mobileNavigation?: ReactNode;
};

/**
 * Restrained workspace top bar: navigation trigger on the left, account
 * controls on the right. Search lives in the sidebar, and attention signals
 * live on their canonical navigation rows rather than as competing badges.
 *
 * The notification link carries a stable `data-has-unread` state so styling
 * never depends on dynamic accessible text.
 */
export function TopBar({ metrics, identity, mobileNavigation }: TopBarProps) {
  const canonicalUrl = useCanonicalUrl();
  const unreadCount = metrics.unreadNotificationCount;
  const notificationLabel =
    unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications";

  return (
    <header className="app-topbar ega-topbar workspace-topbar">
      <div className="app-topbar-context">{mobileNavigation}</div>

      <div className="app-topbar-actions">
        <Link
          href={canonicalUrl.resolve("/notifications")}
          className="topbar-icon-button topbar-notification"
          aria-label={notificationLabel}
          title={notificationLabel}
          data-has-unread={unreadCount > 0 ? "true" : "false"}
        >
          <Bell aria-hidden="true" />
          {unreadCount > 0 ? <span className="notification-dot" aria-hidden="true" /> : null}
        </Link>

        <Link
          href={canonicalUrl.resolve("/settings/account")}
          className="topbar-account"
          aria-label={`Account settings for ${identity.email || identity.name}`}
          suppressHydrationWarning
        >
          <span className="topbar-account-copy">
            <span className="topbar-account-name">{identity.name}</span>
            <span className="topbar-account-email">{identity.email}</span>
          </span>
          <span className="topbar-avatar" aria-hidden="true">
            {identity.initials}
          </span>
        </Link>
      </div>
    </header>
  );
}
