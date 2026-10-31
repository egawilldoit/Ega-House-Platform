"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import type { ShellIdentity, WorkspaceShellMetrics } from "@/lib/workspace-shell";
import { OfflineBanner } from "./offline-banner";
import { Sidebar, type SidebarFavorite, type SidebarProject } from "./sidebar";
import { SidebarMobileDrawer } from "./sidebar-mobile-drawer";
import { TopBar } from "./top-bar";

type WorkspaceShellProps = {
  favorites?: SidebarFavorite[];
  children: ReactNode;
  projects?: SidebarProject[];
  metrics: WorkspaceShellMetrics;
  identity: ShellIdentity;
};

function buildBreadcrumb(pathname: string) {
  return null;
}

/**
 * The authenticated workspace frame.
 *
 * Owns the single collapse state shared by the sidebar and the content column.
 * Server components pass data and page children in; only chrome is interactive.
 */
export function WorkspaceShell({
  children,
  favorites = [],
  projects = [],
  metrics,
  identity,
}: WorkspaceShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  return (
    <div
      data-workspace-theme="workspace"
      data-ega-shell-root
      className="ega-app-shell app-shell"
      data-collapsed={collapsed ? "true" : "false"}
    >
      <Sidebar
        favorites={favorites}
        projects={projects}
        metrics={metrics}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
      />

      <main className="app-main workspace-main" style={{ maxWidth: "100%" }}>
        <OfflineBanner />
        <TopBar
          metrics={metrics}
          identity={identity}
          mobileNavigation={<SidebarMobileDrawer projects={projects} metrics={metrics} />}
        />

        <div className="app-page ega-shell-max">
          <div className="app-content">{children}</div>
        </div>
      </main>
    </div>
  );
}
