import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";

import { cn } from "@/lib/utils";
import { Sidebar, type SidebarGoal, type SidebarProject } from "./sidebar";
import { TopBar } from "./top-bar";

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
  const [projects, goals] = await Promise.all([
    getSidebarProjects(),
    getSidebarGoals(),
  ]);

  return (
    <div className={cn("min-h-dvh bg-background text-foreground flex selection:bg-secondary selection:text-foreground", className)}>
      <Sidebar projects={projects} goals={goals} />

      <main className="ega-main">
        <TopBar />

        <div className="flex-1 overflow-y-auto">
          {/* Page header */}
          <div className="ega-page-header">
            <div className="ega-shell-max ega-shell-page-head">
              <div>
                {eyebrow && (
                  <div className="sidebar-section-label ega-shell-eyebrow">{eyebrow}</div>
                )}
                <h1 className="ega-shell-title">{title}</h1>
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
