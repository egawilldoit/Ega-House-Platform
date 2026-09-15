"use client";

import { useState } from "react";
import Image from "next/image";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { InboxCaptureTrigger } from "@/components/inbox/inbox-capture-trigger";
import type { WorkspaceShellMetrics } from "@/lib/workspace-shell";
import { SidebarCreateTaskButton } from "./sidebar-create-task";
import { SidebarNavigation, type SidebarProject } from "./sidebar-navigation";

export type { SidebarGoal, SidebarProject } from "./sidebar-navigation";

type SidebarProps = {
  projects?: SidebarProject[];
  metrics: WorkspaceShellMetrics;
};

export function Sidebar({ projects = [], metrics }: SidebarProps) {
  // Local UI state only; cross-session persistence is not required.
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className="ega-sidebar workspace-sidebar"
      aria-label="Primary workspace sidebar"
      data-collapsed={collapsed ? "true" : "false"}
    >
      <div className="sidebar-brand workspace-sidebar-brand">
        <Image
          src="/logo.svg"
          alt=""
          width={38}
          height={38}
          priority
          className="sidebar-brand-logo"
        />
        <div className="workspace-brand-copy">
          <div className="sidebar-brand-title">EGA House</div>
          <div className="sidebar-brand-subtitle">Operating system</div>
        </div>
        <span className="workspace-brand-index" aria-hidden="true">
          OS / 01
        </span>
        <button
          type="button"
          className="workspace-sidebar-collapse"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          data-testid="sidebar-collapse-toggle"
          onClick={() => setCollapsed((current) => !current)}
        >
          {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
        </button>
      </div>

      <div className="workspace-quick-task flex flex-col gap-2">
        <InboxCaptureTrigger />
      </div>

      <div className="workspace-create-task flex flex-col">
        <SidebarCreateTaskButton />
      </div>

      <SidebarNavigation projects={projects} metrics={metrics} compact={collapsed} />
    </aside>
  );
}
