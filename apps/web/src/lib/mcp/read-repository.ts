import type { SupabaseClient } from "@supabase/supabase-js";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";

export type McpProject = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type McpGoal = {
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

export type McpTask = {
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

export type McpGoalFilters = {
  projectId?: string;
  limit?: number;
};

export type McpTaskFilters = {
  projectId?: string;
  goalId?: string;
  status?: string;
  priority?: string;
  includeArchived?: boolean;
  limit?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  errorMessage: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(errorMessage);
  }
  return value;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  errorMessage: string,
): string | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(errorMessage);
  return value;
}

function optionalNumber(
  record: Record<string, unknown>,
  key: string,
  errorMessage: string,
): number | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(errorMessage);
  }
  return value;
}

function relatedString(value: unknown, key: string): string | null {
  const related = Array.isArray(value) ? value[0] : value;
  if (related === null || related === undefined) return null;
  if (!isRecord(related)) return null;
  const nested = related[key];
  return typeof nested === "string" ? nested : null;
}

function normalizeLimit(value: number | undefined, defaultLimit = 25): number {
  const limit = value ?? defaultLimit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("MCP list limit must be between 1 and 100.");
  }
  return limit;
}

function mapProject(value: unknown): McpProject {
  const errorMessage = "Invalid EGA project record.";
  if (!isRecord(value)) throw new Error(errorMessage);

  return {
    id: requireString(value, "id", errorMessage),
    name: requireString(value, "name", errorMessage),
    slug: requireString(value, "slug", errorMessage),
    description: optionalString(value, "description", errorMessage),
    status: requireString(value, "status", errorMessage),
    createdAt: requireString(value, "created_at", errorMessage),
    updatedAt: requireString(value, "updated_at", errorMessage),
  };
}

function mapGoal(value: unknown): McpGoal {
  const errorMessage = "Invalid EGA goal record.";
  if (!isRecord(value)) throw new Error(errorMessage);

  return {
    id: requireString(value, "id", errorMessage),
    projectId: requireString(value, "project_id", errorMessage),
    title: requireString(value, "title", errorMessage),
    slug: optionalString(value, "slug", errorMessage),
    description: optionalString(value, "description", errorMessage),
    nextStep: optionalString(value, "next_step", errorMessage),
    health: optionalString(value, "health", errorMessage),
    status: requireString(value, "status", errorMessage),
    createdAt: requireString(value, "created_at", errorMessage),
    updatedAt: requireString(value, "updated_at", errorMessage),
  };
}

function mapTask(value: unknown): McpTask {
  const errorMessage = "Invalid EGA task record.";
  if (!isRecord(value)) throw new Error(errorMessage);

  return {
    id: requireString(value, "id", errorMessage),
    projectId: requireString(value, "project_id", errorMessage),
    goalId: optionalString(value, "goal_id", errorMessage),
    title: requireString(value, "title", errorMessage),
    description: optionalString(value, "description", errorMessage),
    blockedReason: optionalString(value, "blocked_reason", errorMessage),
    status: requireString(value, "status", errorMessage),
    priority: requireString(value, "priority", errorMessage),
    estimateMinutes: optionalNumber(value, "estimate_minutes", errorMessage),
    focusRank: optionalNumber(value, "focus_rank", errorMessage),
    dueDate: optionalString(value, "due_date", errorMessage),
    plannedForDate: optionalString(value, "planned_for_date", errorMessage),
    scheduledStartAt: optionalString(value, "scheduled_start_at", errorMessage),
    scheduledEndAt: optionalString(value, "scheduled_end_at", errorMessage),
    completedAt: optionalString(value, "completed_at", errorMessage),
    archivedAt: optionalString(value, "archived_at", errorMessage),
    createdAt: requireString(value, "created_at", errorMessage),
    updatedAt: requireString(value, "updated_at", errorMessage),
    projectName: relatedString(value.projects, "name"),
    goalTitle: relatedString(value.goals, "title"),
  };
}

export async function listMcpProjects(
  client: SupabaseClient<McpDatabase>,
  ownerUserId: string,
  requestedLimit?: number,
): Promise<McpProject[]> {
  const limit = normalizeLimit(requestedLimit);
  const { data, error } = await client
    .from("projects")
    .select("id, name, slug, description, status, created_at, updated_at")
    .eq("owner_user_id", ownerUserId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  if (error) throw new Error("Failed to load EGA projects.");
  return (data ?? []).map((row) => mapProject(row as unknown));
}

export async function listMcpGoals(
  client: SupabaseClient<McpDatabase>,
  ownerUserId: string,
  filters: McpGoalFilters = {},
): Promise<McpGoal[]> {
  const limit = normalizeLimit(filters.limit);
  let query = client
    .from("goals")
    .select(
      "id, project_id, title, slug, description, next_step, health, status, created_at, updated_at",
    )
    .eq("owner_user_id", ownerUserId);

  if (filters.projectId) {
    query = query.eq("project_id", filters.projectId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  if (error) throw new Error("Failed to load EGA goals.");
  return (data ?? []).map((row) => mapGoal(row as unknown));
}

export async function listMcpTasks(
  client: SupabaseClient<McpDatabase>,
  ownerUserId: string,
  filters: McpTaskFilters = {},
): Promise<McpTask[]> {
  const limit = normalizeLimit(filters.limit);
  let query = client
    .from("tasks")
    .select(
      `id, project_id, goal_id, title, description, blocked_reason, status, priority,
       estimate_minutes, focus_rank, due_date, planned_for_date,
       scheduled_start_at, scheduled_end_at, completed_at, archived_at,
       created_at, updated_at, projects!inner(name), goals(title)`,
    )
    .eq("owner_user_id", ownerUserId);

  if (filters.projectId) query = query.eq("project_id", filters.projectId);
  if (filters.goalId) query = query.eq("goal_id", filters.goalId);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.priority) query = query.eq("priority", filters.priority);
  if (!filters.includeArchived) query = query.is("archived_at", null);

  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  if (error) throw new Error("Failed to load EGA tasks.");
  return (data ?? []).map((row) => mapTask(row as unknown));
}
