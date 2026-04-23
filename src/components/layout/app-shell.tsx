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
    const { data } = await supabase
      .from("projects")
      .select("id, name")
      .order("name", { ascending: true })
      .limit(12);
    return data ?? [];
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
    <div className={cn("min-h-dvh bg-background text-foreground flex selection:bg-secondary selection:text-foreground", className)}>
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
