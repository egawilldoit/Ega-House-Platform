"use client";

import Image from "next/image";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useState } from "react";

import { InboxQuickCapture } from "@/components/inbox/inbox-quick-capture";
import type { WorkspaceShellMetrics } from "@/lib/workspace-shell";
import {
  SidebarNavigation,
  type SidebarGoal,
  type SidebarProject,
} from "./sidebar-navigation";

export type { SidebarGoal, SidebarProject } from "./sidebar-navigation";

type SidebarProps = {
  projects?: SidebarProject[];
  goals?: SidebarGoal[];
  metrics: WorkspaceShellMetrics;
};

export function Sidebar({ projects = [], goals = [], metrics }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className="ega-sidebar workspace-sidebar"
      aria-label="Primary workspace sidebar"
      data-collapsed={collapsed}
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
          aria-label={collapsed ? "Expand workspace sidebar" : "Collapse workspace sidebar"}
          aria-pressed={collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          data-testid="workspace-sidebar-collapse"
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
        </button>
      </div>

      <div className="workspace-quick-task flex flex-col gap-2">
        <InboxQuickCapture projects={projects} goals={goals} />
      </div>

      <SidebarNavigation projects={projects} metrics={metrics} compact={collapsed} />
    </aside>
  );
}
