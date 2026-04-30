import { createClient } from "@/lib/supabase/server";
import {
  isMissingSupabaseColumn,
  isMissingTasksArchivedAtColumn,
  isMissingTasksBlockedReasonColumn,
  isMissingTasksCompletedAtColumn,
} from "@/lib/supabase-error";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type NormalizedTaskRow = {
  id: string;
  title: string;
  description: string | null;
  blocked_reason: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  estimate_minutes: number | null;
  updated_at: string;
  completed_at: string | null;
  project_id: string;
  goal_id: string | null;
  focus_rank: number | null;
  planned_for_date: string | null;
  archived_at: string | null;
  archived_by: string | null;
  projects: { name: string; slug?: string | null } | null;
  goals: { title: string } | null;
};

export type TaskPlanningReadMode = "selected" | "pinned" | "inProgress";

type RawTaskRow = Partial<NormalizedTaskRow> & {
  id: string;
  title: string;
  status: string;
  priority: string;
  updated_at: string;
  project_id: string;
};

type TaskReadQueryResult = {
  data: unknown[] | null;
  error: {
    code?: string | null;
    message: string;
    details?: string | null;
    hint?: string | null;
  } | null;
};

type TaskReadQuery = PromiseLike<TaskReadQueryResult> & {
  eq(column: string, value: unknown): TaskReadQuery;
  neq(column: string, value: unknown): TaskReadQuery;
  in(column: string, values: unknown[]): TaskReadQuery;
  gte(column: string, value: unknown): TaskReadQuery;
  lte(column: string, value: unknown): TaskReadQuery;
  is(column: string, value: null): TaskReadQuery;
  not(column: string, operator: string, value: unknown): TaskReadQuery;
  or(filters: string): TaskReadQuery;
  order(column: string, options?: { ascending?: boolean }): TaskReadQuery;
  limit(count: number): TaskReadQuery;
};

type TaskReadSelectVariant = {
  blockedReason: boolean;
  completedAt: boolean;
  archive: boolean;
};

const MODERN_TASK_SELECT_VARIANT: TaskReadSelectVariant = {
  blockedReason: true,
  completedAt: true,
  archive: true,
};

const TASK_BASE_SELECT_COLUMNS = [
  "id",
  "title",
  "description",
  "status",
  "priority",
  "due_date",
  "estimate_minutes",
  "updated_at",
  "project_id",
  "goal_id",
  "focus_rank",
  "planned_for_date",
];

async function resolveSupabaseClient(supabase?: SupabaseServerClient) {
  if (supabase) {
    return supabase;
  }

  return createClient();
}

function isMissingTasksArchivedByColumn(
  error: { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } | null | undefined,
) {
  return isMissingSupabaseColumn(error, "public.tasks", "archived_by");
}

function getTaskSelect(variant: TaskReadSelectVariant) {
  return [
    ...TASK_BASE_SELECT_COLUMNS.slice(0, 3),
    ...(variant.blockedReason ? ["blocked_reason"] : []),
    ...TASK_BASE_SELECT_COLUMNS.slice(3),
    ...(variant.completedAt ? ["completed_at"] : []),
    ...(variant.archive ? ["archived_at", "archived_by"] : []),
    "projects(name, slug)",
    "goals(title)",
  ].join(", ");
}

function getFallbackSelectVariant(
  error: { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } | null,
  current: TaskReadSelectVariant,
) {
  if (current.blockedReason && isMissingTasksBlockedReasonColumn(error)) {
    return { ...current, blockedReason: false };
  }

  if (current.completedAt && isMissingTasksCompletedAtColumn(error)) {
    return { ...current, completedAt: false };
  }

  if (
    current.archive &&
    (isMissingTasksArchivedAtColumn(error) || isMissingTasksArchivedByColumn(error))
  ) {
    return { ...current, archive: false };
  }

  return null;
}

function withVariantFallbacks(row: RawTaskRow, variant: TaskReadSelectVariant): RawTaskRow {
  return {
    ...row,
    blocked_reason: variant.blockedReason ? row.blocked_reason ?? null : null,
    completed_at: variant.completedAt ? row.completed_at ?? null : null,
    archived_at: variant.archive ? row.archived_at ?? null : null,
    archived_by: variant.archive ? row.archived_by ?? null : null,
  };
}

export function normalizeTaskRow(row: RawTaskRow): NormalizedTaskRow {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    blocked_reason: row.blocked_reason ?? null,
    status: row.status,
    priority: row.priority,
    due_date: row.due_date ?? null,
    estimate_minutes: row.estimate_minutes ?? null,
    updated_at: row.updated_at,
    completed_at: row.completed_at ?? null,
    project_id: row.project_id,
    goal_id: row.goal_id ?? null,
    focus_rank: row.focus_rank ?? null,
    planned_for_date: row.planned_for_date ?? null,
    archived_at: row.archived_at ?? null,
    archived_by: row.archived_by ?? null,
    projects: row.projects ?? null,
    goals: row.goals ?? null,
  };
}

export async function getTaskForOwner(
  taskId: string,
  options?: { supabase?: SupabaseServerClient },
): Promise<{ data: NormalizedTaskRow | null; errorMessage: string | null }> {
  const normalizedTaskId = taskId.trim();

  if (!normalizedTaskId) {
    return { data: null, errorMessage: "Task is required." };
  }

  const supabase = await resolveSupabaseClient(options?.supabase);
  let variant = MODERN_TASK_SELECT_VARIANT;

  for (;;) {
    const { data, error } = await supabase
      .from("tasks")
      .select(getTaskSelect(variant))
      .eq("id", normalizedTaskId)
      .maybeSingle();

    if (!error) {
      return {
        data: data
          ? normalizeTaskRow(withVariantFallbacks(data as unknown as RawTaskRow, variant))
          : null,
        errorMessage: null,
      };
    }

    const fallbackVariant = getFallbackSelectVariant(error, variant);
    if (!fallbackVariant) {
      return { data: null, errorMessage: error.message };
    }

    variant = fallbackVariant;
  }
}

export async function getActiveTasksForOwner(options?: {
  supabase?: SupabaseServerClient;
  includeArchived?: boolean;
  archiveFilter?: "active" | "archived" | "all";
  applyQuery?: (query: TaskReadQuery) => TaskReadQuery;
  orderByUpdatedAt?: boolean;
}): Promise<{ data: NormalizedTaskRow[]; errorMessage: string | null }> {
  const supabase = await resolveSupabaseClient(options?.supabase);
  let variant = MODERN_TASK_SELECT_VARIANT;
  const archiveFilter = options?.archiveFilter ?? (options?.includeArchived ? "all" : "active");

  for (;;) {
    if (!variant.archive && archiveFilter === "archived") {
      return { data: [], errorMessage: null };
    }

    let query = supabase.from("tasks").select(getTaskSelect(variant)) as unknown as TaskReadQuery;

    if (archiveFilter === "active" && variant.archive) {
      query = query.is("archived_at", null);
    } else if (archiveFilter === "archived" && variant.archive) {
      query = query.not("archived_at", "is", null);
    }

    if (options?.applyQuery) {
      query = options.applyQuery(query);
    }

    if (options?.orderByUpdatedAt !== false) {
      query = query.order("updated_at", { ascending: false });
    }

    const { data, error } = await query;

    if (!error) {
      return {
        data: (data ?? []).map((row) =>
          normalizeTaskRow(withVariantFallbacks(row as unknown as RawTaskRow, variant)),
        ),
        errorMessage: null,
      };
    }

    const fallbackVariant = getFallbackSelectVariant(error, variant);
    if (!fallbackVariant) {
      return { data: [], errorMessage: error.message };
    }

    variant = fallbackVariant;
  }
}

export function getTasksForTodayPlanning(options: {
  supabase: SupabaseServerClient;
  mode: TaskPlanningReadMode;
  today: string;
}) {
  const { mode, today } = options;

  return getActiveTasksForOwner({
    supabase: options.supabase,
    orderByUpdatedAt: false,
    applyQuery(query) {
      if (mode === "selected") {
        return query
          .or(`planned_for_date.eq.${today},due_date.eq.${today}`)
          .order("updated_at", { ascending: false })
          .limit(240);
      }

      if (mode === "pinned") {
        return query
          .not("focus_rank", "is", null)
          .neq("status", "done")
          .order("focus_rank", { ascending: true })
          .order("updated_at", { ascending: false })
          .limit(80);
      }

      return query
        .eq("status", "in_progress")
        .order("updated_at", { ascending: false })
        .limit(80);
    },
  });
}

export function getTasksForReview(options: {
  supabase: SupabaseServerClient;
  limit?: number;
}) {
  return getActiveTasksForOwner({
    supabase: options.supabase,
    orderByUpdatedAt: false,
    applyQuery(query) {
      return query
        .eq("status", "blocked")
        .order("updated_at", { ascending: false })
        .limit(options.limit ?? 6);
    },
  });
}
