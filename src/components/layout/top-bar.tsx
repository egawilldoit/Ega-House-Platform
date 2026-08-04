"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Keyboard, Mail, Search } from "lucide-react";

import type { WorkspaceShellMetrics } from "@/lib/workspace-shell";
import { useCanonicalUrl } from "@/lib/use-canonical-url";
import { getShellRouteMeta } from "./shell-route-meta";
import { TopBarSignalCluster } from "./shell-signals";
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

        <label className="shell-search workspace-shell-search">
          <Search aria-hidden="true" />
          <span className="sr-only">Search workspace</span>
          <input
            type="search"
            placeholder="Search tasks, goals, projects..."
            aria-label="Search tasks, goals, and projects"
          />
          <kbd>Ctrl K</kbd>
        </label>

        <div className="topbar-actions workspace-topbar-actions">
          <TopBarSignalCluster metrics={metrics} />

          <Link href={canonicalUrl.resolve("/apps")} className="ega-topbar-upgrade-pill">
            Apps
          </Link>

          <button
            type="button"
            className="workspace-topbar-control workspace-shortcut-control"
            aria-label="Open keyboard shortcuts"
            onClick={() =>
              window.dispatchEvent(new CustomEvent(workspaceShortcutEvents.openHelp))
            }
          >
            <Keyboard aria-hidden="true" />
            <span>Shortcuts</span>
            <kbd>?</kbd>
          </button>

          <button type="button" className="workspace-topbar-icon" aria-label="Messages">
            <Mail aria-hidden="true" />
          </button>

          <button type="button" className="workspace-topbar-icon" aria-label="Notifications">
            <Bell aria-hidden="true" />
            <span className="workspace-notification-signal" aria-hidden="true" />
          </button>

          <div className="ega-topbar-avatar" aria-label="User profile" suppressHydrationWarning>
            EG
          </div>
        </div>
      </div>
    </header>
  );
}
