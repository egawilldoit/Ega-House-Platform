// Agent task service — orchestrates Supabase queries with strict owner scoping.
// Uses the admin service client (bypasses RLS) so every query MUST filter by
// owner_user_id to enforce multi-tenant isolation.
//
// Wraps the existing Supabase-dependent services:
//   - task-read-service.ts (getActiveTasksForOwner, etc.)
//   - task-service.ts (getTaskInsertScopeError, getTaskScopeSnapshot)
//
// Later issues will add create, update, and archive operations.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { TaskScopeSnapshot } from "@/lib/services/task-service";
import {
  getTaskInsertScopeError,
} from "@/lib/services/task-service";

// ---- Types ----

export type ServiceListResult<T> =
  | { ok: true; data: T[] }
  | { ok: false; errorMessage: string };

// ---- Helpers ----

function createServiceClient() {
  return getSupabaseServiceClient();
}

// ---- Projects ----

export type ProjectRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export async function getProjects(
  ownerUserId: string,
): Promise<ServiceListResult<ProjectRow>> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("projects")
    .select("id, name, slug, description, status, created_at, updated_at")
    .eq("owner_user_id", ownerUserId)
    .order("created_at", { ascending: false });

  if (error) {
    return {
      ok: false,
      errorMessage: "Failed to load projects.",
    };
  }

  return {
    ok: true,
    data: (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      name: row.name as string,
      slug: row.slug as string,
      description: (row.description as string) ?? null,
      status: row.status as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    })),
  };
}

// ---- Goals ----

export type GoalRow = {
  id: string;
  projectId: string;
  title: string;
  slug: string | null;
  description: string | null;
  nextStep: string | null;
  health: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export async function getGoals(
  ownerUserId: string,
  projectId?: string,
): Promise<ServiceListResult<GoalRow>> {
  const supabase = createServiceClient();

  let query = supabase
    .from("goals")
    .select("id, project_id, title, slug, description, next_step, health, status, created_at, updated_at")
    .eq("owner_user_id", ownerUserId);

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    return {
      ok: false,
      errorMessage: "Failed to load goals.",
    };
  }

  return {
    ok: true,
    data: (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      projectId: row.project_id as string,
      title: row.title as string,
      slug: (row.slug as string) ?? null,
      description: (row.description as string) ?? null,
      nextStep: (row.next_step as string) ?? null,
      health: (row.health as string) ?? null,
      status: row.status as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    })),
  };
}

// ---- Tasks ----

export type TaskRow = {
  id: string;
  projectId: string;
  goalId: string | null;
  title: string;
  description: string | null;
  blockedReason: string | null;
  status: string;
  priority: string;
  estimateMinutes: number | null;
  focusRank: number | null;
  dueDate: string | null;
  plannedForDate: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  projectName: string | null;
  goalTitle: string | null;
};

export type AgentTaskFilters = {
  projectId?: string;
  goalId?: string;
  status?: string;
  priority?: string;
  limit?: number;
  includeArchived?: boolean;
};

export async function getTasks(
  ownerUserId: string,
  filters?: AgentTaskFilters,
): Promise<ServiceListResult<TaskRow>> {
  const supabase = createServiceClient();

  // Build the select with joins
  let query = supabase
    .from("tasks")
    .select(
      `id, project_id, goal_id, title, description, blocked_reason, status, priority,
       estimate_minutes, focus_rank, due_date, planned_for_date,
       scheduled_start_at, scheduled_end_at, completed_at, archived_at,
       created_at, updated_at,
       projects!inner(name),
       goals(title)`,
    )
    .eq("owner_user_id", ownerUserId);

  if (filters?.projectId) {
    query = query.eq("project_id", filters.projectId);
  }

  if (filters?.goalId) {
    query = query.eq("goal_id", filters.goalId);
  }

  if (filters?.status) {
    query = query.eq("status", filters.status);
  }

  if (filters?.priority) {
    query = query.eq("priority", filters.priority);
  }

  // Default: exclude archived unless explicitly requested
  if (!filters?.includeArchived) {
    query = query.is("archived_at", null);
  }

  if (filters?.limit && filters.limit > 0) {
    query = query.limit(filters.limit);
  }

  const { data, error } = await query.order("updated_at", { ascending: false });

  if (error) {
    return {
      ok: false,
      errorMessage: "Failed to load tasks.",
    };
  }

  return {
    ok: true,
    data: (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      projectId: row.project_id as string,
      goalId: (row.goal_id as string) ?? null,
      title: row.title as string,
      description: (row.description as string) ?? null,
      blockedReason: (row.blocked_reason as string) ?? null,
      status: row.status as string,
      priority: row.priority as string,
      estimateMinutes: (row.estimate_minutes as number) ?? null,
      focusRank: (row.focus_rank as number) ?? null,
      dueDate: (row.due_date as string) ?? null,
      plannedForDate: (row.planned_for_date as string) ?? null,
      scheduledStartAt: (row.scheduled_start_at as string) ?? null,
      scheduledEndAt: (row.scheduled_end_at as string) ?? null,
      completedAt: (row.completed_at as string) ?? null,
      archivedAt: (row.archived_at as string) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      projectName: ((row.projects as Record<string, unknown>)?.name as string) ?? null,
      goalTitle: ((row.goals as Record<string, unknown>)?.title as string) ?? null,
    })),
  };
}

// ---- Scope validation (reuses existing service) ----

export type { TaskScopeSnapshot };

export type ScopeValidationResult =
  | { ok: true; scope: TaskScopeSnapshot }
  | { ok: false; errorMessage: string };

/**
 * Validate that a project/goal scope is valid for the given owner.
 * Uses the existing getTaskInsertScopeError from task-service.ts but
 * with owner-scoped project/goal queries via the service client.
 */
export async function validateTaskScope(
  ownerUserId: string,
  projectId: string,
  goalId?: string | null,
): Promise<ScopeValidationResult> {
  const supabase = createServiceClient();

  // Query projects and goals scoped to this owner
  const [projectsResult, goalsResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id")
      .eq("owner_user_id", ownerUserId),
    supabase
      .from("goals")
      .select("id, project_id")
      .eq("owner_user_id", ownerUserId),
  ]);

  if (projectsResult.error || goalsResult.error) {
    return {
      ok: false,
      errorMessage: "Unable to validate task scope.",
    };
  }

  const scope: TaskScopeSnapshot = {
    projectIds: new Set(
      (projectsResult.data ?? []).map((p: { id: string }) => p.id),
    ),
    goalsById: new Map(
      (goalsResult.data ?? []).map((g: { id: string; project_id: string }) => [
        g.id,
        g,
      ]),
    ),
  };

  const scopeError = getTaskInsertScopeError(
    { project_id: projectId, goal_id: goalId ?? null } as never,
    scope,
  );

  if (scopeError) {
    return {
      ok: false,
      errorMessage: scopeError,
    };
  }

  return {
    ok: true,
    scope,
  };
}
