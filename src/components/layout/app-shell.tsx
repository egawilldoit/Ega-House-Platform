import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceShellMetrics } from "@/lib/workspace-shell";

import { cn } from "@/lib/utils";
import { Sidebar, type SidebarGoal, type SidebarProject } from "./sidebar";
import { TopBar } from "./top-bar";
import { WorkspaceKeyboardShortcuts } from "./workspace-keyboard-shortcuts";

type AppShellProps = {
  children: ReactNode;
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Legacy – no longer rendered */
  navigation?: ReactNode;
  className?: string;
  contentClassName?: string;
};

async function getSidebarProjects(): Promise<SidebarProject[]> {
  try {
    const supabase = await createClient();
    const { data: projectRows, error: projectsError } = await supabase
      .from("projects")
      .select("id, name, slug, status, updated_at")
      .order("updated_at", { ascending: false })
      .limit(24);

    if (projectsError || !projectRows?.length) {
      return [];
    }

    const projectIds = projectRows.map((project) => project.id);
    const { data: taskRows } = await supabase
      .from("tasks")
      .select("project_id, status")
      .in("project_id", projectIds)
      .neq("status", "done")
      .limit(1000);

    const activeTaskCounts = new Map<string, number>();
    for (const task of taskRows ?? []) {
      activeTaskCounts.set(
        task.project_id,
        (activeTaskCounts.get(task.project_id) ?? 0) + 1,
      );
    }

    return projectRows
      .map((project, index) => ({
        id: project.id,
        name: project.name,
        slug: project.slug,
        status: project.status,
        activeTaskCount: activeTaskCounts.get(project.id) ?? 0,
        isPinned: index < 6 && project.status !== "archived",
      }))
      .sort((left, right) => {
        if (left.isPinned !== right.isPinned) {
          return left.isPinned ? -1 : 1;
        }

        return left.name.localeCompare(right.name);
      });
  } catch {
    return [];
  }
}

async function getSidebarGoals(): Promise<SidebarGoal[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("goals")
      .select("id, title, project_id")
      .order("created_at", { ascending: false })
      .limit(50);
    return data ?? [];
  } catch {
    return [];
  }
}

export async function AppShell({
  children,
  eyebrow,
  title,
  description,
  actions,
  className,
  contentClassName,
}: AppShellProps) {
  const [projects, goals, metrics] = await Promise.all([
    getSidebarProjects(),
    getSidebarGoals(),
    getWorkspaceShellMetrics(),
  ]);

  return (
    <div className={cn("ega-app-shell text-foreground selection:bg-secondary selection:text-foreground", className)}>
      <Sidebar projects={projects} goals={goals} metrics={metrics} />

      <main className="ega-main">
        <WorkspaceKeyboardShortcuts />
        <TopBar metrics={metrics} />

        <div className="flex-1 overflow-y-auto">
          {/* Page header */}
          <div className="ega-page-header">
            <div className="ega-shell-max ega-shell-page-head">
              <div>
                {eyebrow && (
                  <div className="ega-shell-eyebrow">{eyebrow}</div>
                )}
                <h1 tabIndex={-1} data-shell-page-title className="ega-shell-title focus:outline-none">{title}</h1>
                {description && (
                  <p className="ega-shell-description">{description}</p>
                )}
              </div>
              {actions && (
                <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>
              )}
            </div>
          </div>

          {/* Content */}
          <div className={cn("ega-content ega-shell-max", contentClassName)}>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
