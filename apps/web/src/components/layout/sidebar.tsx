"use client";

import Image from "next/image";

import { QuickTaskSheet } from "@/components/tasks/quick-task-sheet";
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
  return (
    <aside className="ega-sidebar workspace-sidebar" aria-label="Primary workspace sidebar">
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
      </div>

      <div className="workspace-quick-task">
        <QuickTaskSheet projects={projects} goals={goals} />
      </div>

      <SidebarNavigation projects={projects} metrics={metrics} />
    </aside>
  );
}
