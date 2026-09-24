"use client";

import Image from "next/image";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { InboxCaptureTrigger } from "@/components/inbox/inbox-capture-trigger";
import type { WorkspaceShellMetrics } from "@/lib/workspace-shell";
import { SidebarCreateTaskButton } from "./sidebar-create-task";
import { SidebarNavigation, type SidebarProject } from "./sidebar-navigation";
import { WorkspaceSearchTrigger } from "./workspace-search-trigger";

export type { SidebarGoal, SidebarProject } from "./sidebar-navigation";

type SidebarProps = {
  projects?: SidebarProject[];
  metrics: WorkspaceShellMetrics;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
};

export function Sidebar({
  projects = [],
  metrics,
  collapsed = false,
  onCollapsedChange,
}: SidebarProps) {
  return (
    <aside
      className="ega-sidebar app-sidebar workspace-sidebar"
      aria-label="Primary workspace sidebar"
      data-collapsed={collapsed ? "true" : "false"}
    >
      {/* Brand and search stay pinned above the single scroll region. */}
      <div className="flex shrink-0 flex-col gap-1">
        <div className="sidebar-brand workspace-sidebar-brand">
          <Image
            src="/logo.svg"
            alt=""
            width={26}
            height={26}
            priority
            className="sidebar-brand-logo"
          />
          <div className="workspace-brand-copy">
            <div className="sidebar-brand-title">EGA House</div>
          </div>
          <button
            type="button"
            className="workspace-sidebar-collapse"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            data-testid="sidebar-collapse-toggle"
            onClick={() => onCollapsedChange?.(!collapsed)}
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" />
            ) : (
              <PanelLeftClose aria-hidden="true" />
            )}
          </button>
        </div>

        <div className="px-1.5 pb-1">
          <WorkspaceSearchTrigger />
        </div>
      </div>

      {/* The only scroll region: primary navigation, workspaces, system nav. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain [scrollbar-width:thin]">
        <SidebarNavigation
          projects={projects}
          metrics={metrics}
          compact={collapsed}
          className="overflow-visible"
        />
      </div>

      {/* Capture and Create task stay pinned below the scroll region. */}
      <div className="mt-1 flex shrink-0 flex-col gap-1.5 border-t border-[var(--ega-border)] px-1.5 pt-2">
        <InboxCaptureTrigger />
        <SidebarCreateTaskButton />
      </div>
    </aside>
  );
}
