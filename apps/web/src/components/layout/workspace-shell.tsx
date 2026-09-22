"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import type { ShellIdentity, WorkspaceShellMetrics } from "@/lib/workspace-shell";
import { cn } from "@/lib/utils";
import { Sidebar, type SidebarProject } from "./sidebar";
import { SidebarMobileDrawer } from "./sidebar-mobile-drawer";
import { TopBar } from "./top-bar";
import { getShellRouteMeta } from "./shell-route-meta";

type WorkspaceShellProps = {
  children: ReactNode;
  projects?: SidebarProject[];
  metrics: WorkspaceShellMetrics;
  identity: ShellIdentity;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
  contentClassName?: string;
};

function buildBreadcrumb(pathname: string) {
  const route = getShellRouteMeta(pathname);
  if (route.href === "/home") {
    return "Home";
  }

  return `Home › ${route.label}`;
}

/**
 * The authenticated workspace frame.
 *
 * Owns the single collapse state shared by the sidebar and the content column.
 * Server components pass data and page children in; only chrome is interactive.
 */
export function WorkspaceShell({
  children,
  projects = [],
  metrics,
  identity,
  title,
  description,
  actions,
  className,
  contentClassName,
}: WorkspaceShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  return (
    <div
      data-workspace-theme="workspace"
      className={cn("ega-app-shell app-shell", className)}
      data-collapsed={collapsed ? "true" : "false"}
    >
      <Sidebar
        projects={projects}
        metrics={metrics}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
      />

      <main className="app-main workspace-main">
        <TopBar
          metrics={metrics}
          identity={identity}
          mobileNavigation={<SidebarMobileDrawer projects={projects} metrics={metrics} />}
        />

        <div className="app-page ega-shell-max">
          <header className="app-page-header">
            <div className="app-page-heading">
              <div className="app-page-eyebrow">{buildBreadcrumb(pathname)}</div>
              <h1
                tabIndex={-1}
                data-shell-page-title
                className="app-page-title focus:outline-none"
              >
                {title}
              </h1>
              {description ? <p className="app-page-description">{description}</p> : null}
            </div>
            {actions ? <div className="app-page-actions">{actions}</div> : null}
          </header>

          <div className={cn("app-content", contentClassName)}>{children}</div>
        </div>
      </main>
    </div>
  );
}
