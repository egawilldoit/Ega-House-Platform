"use client";

import type { ReactNode } from "react";
import Link from "next/link";

import type { ShellIdentity, WorkspaceShellMetrics } from "@/lib/workspace-shell";
import { useCanonicalUrl } from "@/lib/use-canonical-url";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { ThemeControl } from "./theme-control";

type TopBarProps = {
  metrics: WorkspaceShellMetrics;
  identity: ShellIdentity;
  mobileNavigation?: ReactNode;
  /** Global client actions supplied by the provider tree, never page content. */
  topBarExtra?: ReactNode;
};

/**
 * Restrained workspace top bar: navigation trigger on the left, account
 * controls on the right. Search lives in the sidebar, and attention signals
 * live on their canonical navigation rows rather than as competing badges.
 *
 * The notification control carries a stable `data-has-unread` state so styling
 * never depends on dynamic accessible text.
 */
export function TopBar({ metrics, identity, mobileNavigation, topBarExtra }: TopBarProps) {
  const canonicalUrl = useCanonicalUrl();
  const unreadCount = metrics.unreadNotificationCount;

  return (
    <header className="app-topbar ega-topbar workspace-topbar">
      <div className="app-topbar-context">{mobileNavigation}</div>

      <div className="app-topbar-actions">
        {topBarExtra}
        <ThemeControl />
        <NotificationBell initialUnreadCount={unreadCount} />

        <Link
          href={canonicalUrl.resolve("/settings")}
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
