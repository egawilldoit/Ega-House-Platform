import { cache } from "react";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { getShellIdentity, getWorkspaceShellMetrics } from "@/lib/workspace-shell";
import { getActiveTimerSession } from "@/lib/services/timer-service";
import { listFavorites } from "@/lib/services/favorite-service";

import type { SidebarGoal, SidebarProject } from "@/components/layout/sidebar";
import { ActiveTimerProvider } from "@/components/timer/floating-timer/active-timer-provider";
import { FloatingTimerChip } from "@/components/timer/floating-timer/floating-timer-chip";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { WorkspaceKeyboardShortcuts } from "@/components/layout/workspace-keyboard-shortcuts";
import { GlobalQuickActionControllers } from "@/components/layout/global-quick-action-controllers";
import { ToastProvider } from "@/components/ui/toast-provider";
import {
  ACTIVE_TIMER_UNAUTHENTICATED_MESSAGE,
  ACTIVE_TIMER_UNAVAILABLE_MESSAGE,
  toActiveTimerSnapshot,
  type ActiveTimerReadResult,
} from "@/lib/timer/active-timer-contract";

// Request-level only — see SHELL-PERSISTENCE-EVALUATION.md
const getSidebarProjects = cache(async (): Promise<SidebarProject[]> => {
  try {
    const supabase = await createClient();
    const { data: projectRows, error: projectsError } = await supabase
      .from("projects")
      .select("id, name, slug, status, updated_at, area_id, areas(name, color, icon)")
      .order("updated_at", { ascending: false })
      .limit(24);

    if (projectsError || !projectRows?.length) {
      return [];
    }

    const projectIds = projectRows.map((project) => project.id);

    const { data: taskRows } = await supabase
      .from("tasks")
      .select("project_id")
      .in("project_id", projectIds)
      .neq("status", "done");

    const activeTaskCounts = new Map<string, number>();
    for (const row of taskRows ?? []) {
      if (!row.project_id) {
        continue;
      }
      activeTaskCounts.set(
        row.project_id,
        (activeTaskCounts.get(row.project_id) ?? 0) + 1,
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
        areaId: project.area_id ?? null,
        areaName:
          (Array.isArray(project.areas) ? project.areas[0]?.name : project.areas?.name) ??
          null,
        areaColor:
          (Array.isArray(project.areas) ? project.areas[0]?.color : project.areas?.color) ??
          null,
        areaIcon:
          (Array.isArray(project.areas) ? project.areas[0]?.icon : project.areas?.icon) ??
          null,
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
});

// Request-level only — see SHELL-PERSISTENCE-EVALUATION.md
const getSidebarGoals = cache(async (): Promise<SidebarGoal[]> => {
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
});

async function readInitialActiveTimer(
  ownerUserId: string | null,
): Promise<ActiveTimerReadResult> {
  if (!ownerUserId) {
    return {
      ok: false,
      reason: "unauthenticated",
      message: ACTIVE_TIMER_UNAUTHENTICATED_MESSAGE,
    };
  }

  try {
    const result = await getActiveTimerSession();
    if (result.errorMessage) {
      return {
        ok: false,
        reason: "unavailable",
        message: ACTIVE_TIMER_UNAVAILABLE_MESSAGE,
      };
    }

    return {
      ok: true,
      syncedAt: new Date().toISOString(),
      session: toActiveTimerSnapshot(result.data),
    };
  } catch {
    return {
      ok: false,
      reason: "unavailable",
      message: ACTIVE_TIMER_UNAVAILABLE_MESSAGE,
    };
  }
}

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const [projects, goals, metrics, identity, favoritesResult] = await Promise.all([
    getSidebarProjects(),
    getSidebarGoals(),
    getWorkspaceShellMetrics(),
    getShellIdentity(),
    listFavorites().catch(() => ({ items: [], errorMessage: null })),
  ]);
  const favorites = favoritesResult.items.map((item) => ({
    id: item.favoriteId,
    label: item.label,
    href: item.href,
    kind: item.kind,
  }));
  // One light active-session read per authenticated request. This is not the
  // heavy timer workspace projection used by /timer.
  const initialActiveTimer = await readInitialActiveTimer(identity.id);

  return (
    <ToastProvider>
      <ActiveTimerProvider
        key={identity.id ?? "unauthenticated"}
        ownerUserId={identity.id}
        initialResult={initialActiveTimer}
      >
        <WorkspaceKeyboardShortcuts ownerId={identity.id} />
        <GlobalQuickActionControllers projects={projects} goals={goals} />

        <WorkspaceShell
          favorites={favorites}
          projects={projects}
          metrics={metrics}
          identity={identity}
        >
          {children}
        </WorkspaceShell>

        <FloatingTimerChip />
      </ActiveTimerProvider>
    </ToastProvider>
  );
}
