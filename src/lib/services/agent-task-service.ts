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
import type {
  AgentCreateTaskPayload,
  AgentTaskResponse,
  AgentTaskCreateBulkResponse,
  AgentTaskUpdatePayload,
  AgentTaskUpdateBulkResponse,
} from "@/lib/contracts/agent";

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

// ---- Create tasks (EGA-415) ----

/**
 * Fetch full task records by IDs, joined with project and goal names.
 */
async function fetchTasksByIds(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  ownerUserId: string,
  taskIds: string[],
): Promise<AgentTaskResponse[]> {
  if (taskIds.length === 0) return [];

  const { data } = await supabase
    .from("tasks")
    .select(
      `id, project_id, goal_id, title, description, blocked_reason, status, priority,
       estimate_minutes, focus_rank, due_date, planned_for_date,
       scheduled_start_at, scheduled_end_at, completed_at, archived_at,
       created_at, updated_at,
       projects!inner(name),
       goals(title)`,
    )
    .eq("owner_user_id", ownerUserId)
    .in("id", taskIds);

  const rows = (data ?? []) as Record<string, unknown>[];
  return rows.map((row) => ({
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
  }));
}

/**
 * Prepare insert rows for tasks, collecting errors and idempotency matches.
 */
async function prepareTaskRows(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  ownerUserId: string,
  taskPayloads: AgentCreateTaskPayload[],
  existingRefMap: Map<string, string>,
): Promise<{
  rows: Record<string, unknown>[];
  createdIndices: number[];
  existing: AgentTaskResponse[];
  errors: { index: number; error: string }[];
}> {
  const rows: Record<string, unknown>[] = [];
  const createdIndices: number[] = [];
  const existing: AgentTaskResponse[] = [];
  const errors: { index: number; error: string }[] = [];

  for (let i = 0; i < taskPayloads.length; i++) {
    const payload = taskPayloads[i]!;

    // Idempotency check
    if (payload.source && payload.sourceId) {
      const key = `${payload.source}:${payload.sourceId}`;
      const existingTaskId = existingRefMap.get(key);
      if (existingTaskId) {
        const fetched = await fetchTasksByIds(supabase, ownerUserId, [existingTaskId]);
        if (fetched.length > 0) {
          existing.push(fetched[0]!);
        }
        continue;
      }
    }

    // Validate title
    if (!payload.title || payload.title.trim() === "") {
      errors.push({ index: i, error: "Title is required." });
      continue;
    }

    // Validate projectId
    if (!payload.projectId) {
      errors.push({ index: i, error: "Project ID is required." });
      continue;
    }

    // Validate scope
    const scopeResult = await validateTaskScope(ownerUserId, payload.projectId, payload.goalId ?? null);
    if (!scopeResult.ok) {
      errors.push({ index: i, error: scopeResult.errorMessage });
      continue;
    }

    // Validate blocked status requires blockedReason
    if (payload.status === "blocked" && !payload.blockedReason) {
      errors.push({ index: i, error: "Blocked reason is required when status is blocked." });
      continue;
    }

    // Build insert row
    const now = new Date().toISOString();
    const row: Record<string, unknown> = {
      owner_user_id: ownerUserId,
      project_id: payload.projectId,
      goal_id: payload.goalId ?? null,
      title: payload.title,
      description: payload.description ?? null,
      status: payload.status ?? "todo",
      priority: payload.priority ?? "medium",
      estimate_minutes: payload.estimateMinutes ?? null,
      focus_rank: payload.focusRank ?? null,
      due_date: payload.dueDate ?? null,
      planned_for_date: payload.plannedForDate ?? null,
      scheduled_start_at: payload.scheduledStartAt ?? null,
      scheduled_end_at: payload.scheduledEndAt ?? null,
      blocked_reason: payload.blockedReason ?? null,
      created_at: now,
      updated_at: now,
    };

    // For done status, auto-set completed_at
    if (payload.status === "done") {
      row.completed_at = now;
    }

    rows.push(row);
    createdIndices.push(i);
  }

  return { rows, createdIndices, existing, errors };
}

/**
 * Bulk create tasks with idempotency, validation, and audit logging.
 */
export async function createTasks(
  ownerUserId: string,
  tokenId: string,
  taskPayloads: AgentCreateTaskPayload[],
): Promise<AgentTaskCreateBulkResponse> {
  const supabase = getSupabaseServiceClient();

  // 1. Idempotency: bulk-query task_external_refs for (ownerUserId, source, sourceId) tuples
  const idempotentPairs: { source: string; sourceId: string }[] = [];
  for (const p of taskPayloads) {
    if (p.source && p.sourceId) {
      idempotentPairs.push({ source: p.source, sourceId: p.sourceId });
    }
  }

  const existingRefMap = new Map<string, string>();
  if (idempotentPairs.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: refs } = await (supabase as any)
      .from("task_external_refs")
      .select("source, source_id, task_id")
      .eq("owner_user_id", ownerUserId)
      .in(
        "source",
        [...new Set(idempotentPairs.map((p) => p.source))],
      );

    if (refs) {
      const refRows = refs as Array<{ source: string; source_id: string; task_id: string }>;
      for (const pair of idempotentPairs) {
        const match = refRows.find(
          (r) => r.source === pair.source && r.source_id === pair.sourceId,
        );
        if (match) {
          existingRefMap.set(`${pair.source}:${pair.sourceId}`, match.task_id);
        }
      }
    }
  }

  // 2. Validate and prepare rows
  const { rows, createdIndices, existing, errors } = await prepareTaskRows(
    supabase,
    ownerUserId,
    taskPayloads,
    existingRefMap,
  );

  // 3. Bulk insert
  const created: AgentTaskResponse[] = [];
  if (rows.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertResult = await (supabase as any)
      .from("tasks")
      .insert(rows)
      .select("id");

    if (insertResult.error) {
      // If insert fails, return all as errors
      for (const idx of createdIndices) {
        errors.push({ index: idx, error: "Failed to create task." });
      }
      return { ok: true, created: [], existing, errors } as AgentTaskCreateBulkResponse;
    }

    const insertedIds = ((insertResult.data ?? []) as Array<{ id: string }>).map(
      (r) => r.id,
    );

    // 4. Fetch full task records
    if (insertedIds.length > 0) {
      const fetched = await fetchTasksByIds(supabase, ownerUserId, insertedIds);
      created.push(...fetched);
    }

    // 5. Insert external refs
    const externalRefInserts: Record<string, unknown>[] = [];
    for (let i = 0; i < rows.length; i++) {
      const payload = taskPayloads[createdIndices[i]!]!;
      if (payload.source && payload.sourceId) {
        externalRefInserts.push({
          owner_user_id: ownerUserId,
          task_id: insertedIds[i]!,
          source: payload.source,
          source_id: payload.sourceId,
        });
      }
    }

    if (externalRefInserts.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from("task_external_refs").insert(externalRefInserts);
    }

    // 6. Audit events
    const auditRows = created.map((task) => ({
      owner_user_id: ownerUserId,
      token_id: tokenId,
      event_type: "task.created",
      resource_type: "task",
      resource_id: task.id,
      metadata: {
        title: task.title,
        projectId: task.projectId,
        goalId: task.goalId,
      },
    }));

    if (auditRows.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from("agent_integration_events").insert(auditRows);
    }
  }

  return { ok: true, created, existing, errors };
}

// ---- Update tasks (EGA-416) ----

/**
 * Resolve a task target — by taskId or by source+sourceId via task_external_refs.
 */
async function resolveTaskTarget(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  ownerUserId: string,
  target: { taskId?: string; source?: string; sourceId?: string },
): Promise<{ id: string } | null> {
  if (target.taskId) {
    return { id: target.taskId };
  }

  if (target.source && target.sourceId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("task_external_refs")
      .select("task_id")
      .eq("owner_user_id", ownerUserId)
      .eq("source", target.source)
      .eq("source_id", target.sourceId)
      .maybeSingle();

    if (data) {
      return { id: (data as { task_id: string }).task_id };
    }
    return null;
  }

  return null;
}

/**
 * Update tasks in bulk with allowlist enforcement, ownership verification,
 * and status transition validation.
 */
export async function updateTasks(
  ownerUserId: string,
  tokenId: string,
  updates: AgentTaskUpdatePayload[],
): Promise<AgentTaskUpdateBulkResponse> {
  const supabase = getSupabaseServiceClient();
  const updated: AgentTaskResponse[] = [];
  const errors: { index: number; error: string }[] = [];

  // Allowlisted fields that can be updated
  const ALLOWED_FIELDS = new Set([
    "title", "description", "goalId", "status", "priority",
    "dueDate", "estimateMinutes", "scheduledStartAt", "scheduledEndAt",
    "blockedReason",
  ]);

  for (let i = 0; i < updates.length; i++) {
    const update = updates[i]!;

    // Verify at least one target identifier
    if (!update.taskId && !(update.source && update.sourceId)) {
      errors.push({ index: i, error: "Either taskId or source+sourceId is required." });
      continue;
    }

    // Reject unknown/protected fields by checking update keys
    const invalidKeys = Object.keys(update).filter(
      (k) => k !== "taskId" && k !== "source" && k !== "sourceId" && !ALLOWED_FIELDS.has(k),
    );
    if (invalidKeys.length > 0) {
      errors.push({
        index: i,
        error: `Unknown or protected field(s): ${invalidKeys.join(", ")}`,
      });
      continue;
    }

    // Resolve target
    const resolved = await resolveTaskTarget(supabase, ownerUserId, update);
    if (!resolved) {
      errors.push({ index: i, error: "Task not found." });
      continue;
    }

    // Verify ownership
    const { data: taskData } = await supabase
      .from("tasks")
      .select("owner_user_id, status, completed_at, blocked_reason")
      .eq("id", resolved.id)
      .maybeSingle();

    if (!taskData) {
      errors.push({ index: i, error: "Task not found." });
      continue;
    }

    const task = taskData as { owner_user_id: string; status: string; completed_at: string | null; blocked_reason: string | null };
    if (task.owner_user_id !== ownerUserId) {
      errors.push({ index: i, error: "Task not found." });
      continue;
    }

    // Build update row
    const updateRow: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (update.title !== undefined) updateRow.title = update.title;
    if (update.description !== undefined) updateRow.description = update.description;
    if (update.goalId !== undefined) updateRow.goal_id = update.goalId;
    if (update.priority !== undefined) updateRow.priority = update.priority;
    if (update.dueDate !== undefined) updateRow.due_date = update.dueDate;
    if (update.estimateMinutes !== undefined) updateRow.estimate_minutes = update.estimateMinutes;
    if (update.scheduledStartAt !== undefined) updateRow.scheduled_start_at = update.scheduledStartAt;
    if (update.scheduledEndAt !== undefined) updateRow.scheduled_end_at = update.scheduledEndAt;
    if (update.blockedReason !== undefined) updateRow.blocked_reason = update.blockedReason;

    // Status with validation
    if (update.status !== undefined) {
      if (update.status === "blocked" && !update.blockedReason && !task.blocked_reason) {
        errors.push({ index: i, error: "Blocked reason is required when status is blocked." });
        continue;
      }
      updateRow.status = update.status;
      if (update.status === "done" && !task.completed_at) {
        updateRow.completed_at = new Date().toISOString();
      }
    }

    // Validate scope if goalId changed
    if (update.goalId !== undefined) {
      // We need projectId - fetch the task's current project
      const { data: currentTask } = await supabase
        .from("tasks")
        .select("project_id")
        .eq("id", resolved.id)
        .single();

      if (currentTask) {
        const projectId = (currentTask as { project_id: string }).project_id;
        const scopeResult = await validateTaskScope(ownerUserId, projectId, update.goalId ?? null);
        if (!scopeResult.ok) {
          errors.push({ index: i, error: scopeResult.errorMessage });
          continue;
        }
      }
    }

    // Execute update
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (supabase as any)
      .from("tasks")
      .update(updateRow)
      .eq("id", resolved.id)
      .eq("owner_user_id", ownerUserId);

    if (updateError) {
      errors.push({ index: i, error: "Failed to update task." });
      continue;
    }

    // Fetch updated task
    const fetched = await fetchTasksByIds(supabase, ownerUserId, [resolved.id]);
    if (fetched.length > 0) {
      updated.push(fetched[0]!);
    }

    // Audit event
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("agent_integration_events").insert({
      owner_user_id: ownerUserId,
      token_id: tokenId,
      event_type: "task.updated",
      resource_type: "task",
      resource_id: resolved.id,
      metadata: { updates: Object.keys(updateRow).filter((k) => k !== "updated_at") },
    });
  }

  return { ok: true, updated, errors };
}

// ---- Archive/Unarchive ----

import type {
  AgentTaskArchivePayload,
  AgentTaskArchiveBulkResponse,
} from "@/lib/contracts/agent";

export async function archiveTasks(
  ownerUserId: string,
  tokenId: string,
  archivePayloads: Pick<AgentTaskArchivePayload, "taskId" | "source" | "sourceId" | "archived">[],
): Promise<{
  ok: true;
  archived: AgentTaskResponse[];
  unarchived: AgentTaskResponse[];
  errors: { index: number; error: string }[];
}> {
  const supabase = getSupabaseServiceClient();
  const archived: AgentTaskResponse[] = [];
  const unarchived: AgentTaskResponse[] = [];
  const errors: { index: number; error: string }[] = [];

  for (let i = 0; i < archivePayloads.length; i++) {
    try {
      const p = archivePayloads[i]!;
      let resolved: { id: string; owner_user_id: string } | null = null;

      // Resolve target by taskId or source+sourceId
      if (p.taskId) {
        const { data: task } = await supabase
          .from("tasks")
          .select("id, owner_user_id, archived_at")
          .eq("id", p.taskId)
          .eq("owner_user_id", ownerUserId)
          .maybeSingle();
        if (task) resolved = { id: task.id, owner_user_id: String(task.owner_user_id ?? "") };
      } else if (p.source && p.sourceId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: refRow } = await (supabase as any)
          .from("task_external_refs")
          .select("task_id")
          .eq("owner_user_id", ownerUserId)
          .eq("source", p.source)
          .eq("source_id", p.sourceId)
          .maybeSingle();
        if (refRow?.task_id) {
          const { data: task } = await supabase
            .from("tasks")
            .select("id, owner_user_id, archived_at")
            .eq("id", refRow.task_id)
            .eq("owner_user_id", ownerUserId)
            .maybeSingle();
          if (task) resolved = { id: task.id, owner_user_id: String(task.owner_user_id ?? "") };
        }
      }

      if (!resolved) {
        errors.push({ index: i, error: "Task not found or not owned by this token." });
        continue;
      }

      // Verify ownership (defense-in-depth)
      if (resolved.owner_user_id !== ownerUserId) {
        errors.push({ index: i, error: "Task not found or not owned by this token." });
        continue;
      }

      const now = new Date().toISOString();

      if (p.archived) {
        const { error: updateError } = await supabase
          .from("tasks")
          .update({ archived_at: now, archived_by: ownerUserId, updated_at: now } as never)
          .eq("id", resolved.id);
        if (updateError) {
          errors.push({ index: i, error: "Failed to archive task." });
          continue;
        }
      } else {
        const { error: updateError } = await supabase
          .from("tasks")
          .update({ archived_at: null, archived_by: null, updated_at: now } as never)
          .eq("id", resolved.id);
        if (updateError) {
          errors.push({ index: i, error: "Failed to unarchive task." });
          continue;
        }
      }

      // Fetch full task for response
      const fullTasks = await fetchTasksByIds(supabase, ownerUserId, [resolved.id]);
      if (fullTasks.length > 0) {
        if (p.archived) {
          archived.push(fullTasks[0]!);
        } else {
          unarchived.push(fullTasks[0]!);
        }
      }

      // Audit event
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from("agent_integration_events").insert({
        owner_user_id: ownerUserId,
        token_id: tokenId,
        action: p.archived ? "archive" : "unarchive",
        resource_type: "task",
        resource_id: resolved.id,
        outcome: "success",
      });
    } catch (err) {
      errors.push({ index: i, error: "Unexpected error processing archive request." });
    }
  }

  return { ok: true, archived, unarchived, errors };
}
