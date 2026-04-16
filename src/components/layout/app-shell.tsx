import type { ReactNode } from "react";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

import { cn } from "@/lib/utils";
import { Sidebar, type SidebarProject } from "./sidebar";
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

export async function AppShell({
  children,
  eyebrow,
  title,
  description,
  actions,
  className,
  contentClassName,
}: AppShellProps) {
  const headerStore = await headers();
  const currentPath = headerStore.get("x-current-path") ?? "/";
  const projects = await getSidebarProjects();

  return (
    <div className={cn("min-h-dvh bg-background text-foreground flex selection:bg-secondary selection:text-foreground", className)}>
      <Sidebar projects={projects} currentPath={currentPath} />

      <main className="ega-main">
        <TopBar />

        <div className="flex-1 overflow-y-auto">
          {/* Page header */}
          <div className="ega-page-header">
            <div className="flex items-end justify-between gap-6">
              <div>
                {eyebrow && (
                  <div className="glass-label text-signal-live mb-3">{eyebrow}</div>
                )}
                <h1
                  className="text-4xl font-semibold tracking-tight"
                  style={{
                    fontFamily: "var(--font-display)",
                    color: "var(--foreground)",
                  }}
                >
                  {title}
                </h1>
                {description && (
                  <p
                    className="text-sm mt-2 max-w-2xl"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    {description}
                  </p>
                )}
              </div>
              {actions && (
                <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>
              )}
            </div>
          </div>

          {/* Content */}
          <div className={cn("ega-content", contentClassName)}>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
