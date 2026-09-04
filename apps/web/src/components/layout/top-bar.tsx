"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Keyboard, Search } from "lucide-react";

import type { WorkspaceShellMetrics } from "@/lib/workspace-shell";
import { useCanonicalUrl } from "@/lib/use-canonical-url";
import { Tooltip } from "@/components/ui/tooltip";
import { getShellRouteMeta } from "./shell-route-meta";
import { TopBarSignalCluster } from "./shell-signals";
import { COMMAND_PALETTE_EVENT } from "./command-palette";
import { workspaceShortcutEvents } from "./workspace-keyboard-shortcuts";

type TopBarProps = {
  metrics: WorkspaceShellMetrics;
  mobileNavigation?: ReactNode;
};

export function TopBar({ metrics, mobileNavigation }: TopBarProps) {
  const pathname = usePathname();
  const route = getShellRouteMeta(pathname);
  const canonicalUrl = useCanonicalUrl();

  return (
    <header className="ega-topbar workspace-topbar">
      <div className="ega-shell-max ega-topbar-row workspace-topbar-row">
        <div className="workspace-route-meta">
          {mobileNavigation}
          <span className="workspace-route-index" aria-hidden="true">
            {route.index}
          </span>
          <span className="workspace-route-copy">
            <small>{route.eyebrow}</small>
            <strong>{route.label}</strong>
          </span>
        </div>

        <div className="shell-search workspace-shell-search">
          <Search aria-hidden="true" />
          <button
            type="button"
            className="workspace-search-trigger"
            aria-haspopup="dialog"
            onClick={() => window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_EVENT))}
          >
            <span className="sr-only">Search tasks, goals, and projects</span>
            <span aria-hidden="true">Search tasks, goals, projects…</span>
          </button>
          <kbd>Ctrl K</kbd>
        </div>

        <div className="topbar-actions workspace-topbar-actions">
          <TopBarSignalCluster metrics={metrics} />

          <Link href={canonicalUrl.resolve("/apps")} className="ega-topbar-upgrade-pill">
            Apps
          </Link>

          <Link
            href={canonicalUrl.resolve("/notifications")}
            className="workspace-topbar-icon"
            aria-label={
              metrics.unreadNotificationCount > 0
                ? `Notifications (${metrics.unreadNotificationCount} unread)`
                : "Notifications"
            }
            title="Notifications"
          >
            <Bell aria-hidden="true" />
            {metrics.unreadNotificationCount > 0 ? (
              <>
                <span className="workspace-notification-signal" aria-hidden="true" />
                <span className="sr-only">
                  {metrics.unreadNotificationCount} unread notification{metrics.unreadNotificationCount === 1 ? "" : "s"}
                </span>
              </>
            ) : null}
          </Link>

          <Tooltip content="Keyboard shortcuts (?)">
            <button
              type="button"
              className="workspace-topbar-control workspace-shortcut-control"
              aria-label="Open keyboard shortcuts"
              onClick={() => window.dispatchEvent(new CustomEvent(workspaceShortcutEvents.openHelp))}
            >
              <Keyboard aria-hidden="true" />
              <span>Shortcuts</span>
              <kbd>?</kbd>
            </button>
          </Tooltip>

          <Tooltip content="User menu">
            <Link
              href={canonicalUrl.resolve("/settings/account")}
              className="ega-topbar-avatar"
              aria-label="Account settings"
              suppressHydrationWarning
            >
              EG
            </Link>
          </Tooltip>
        </div>
      </div>
    </header>
  );
}
