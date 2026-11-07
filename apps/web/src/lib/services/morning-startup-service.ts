import type { OperatorSnapshot } from "@ega/application";
import { getLocalDayWindow } from "@ega/domain";
import { DEFAULT_USER_PREFERENCES, type UserPreferences } from "@ega/domain/preferences";

import {
  buildMorningStartupModel,
  MORNING_OUTCOME_UNAVAILABLE_MESSAGE,
  MORNING_STARTUP_PREFERENCES_ERROR_MESSAGE,
  MORNING_STARTUP_YESTERDAY_ERROR_MESSAGE,
  normalizeOutcomeTaskIds,
  validateMorningOutcomeTasks,
  type MorningStartupModel,
  type MorningStartupOwnedTaskRow,
  type MorningStartupYesterdayRow,
} from "@/lib/morning-startup";
import { shiftIsoDateByDays } from "@/lib/review-week";
import { createClient } from "@/lib/supabase/server";
import { planTaskForToday } from "@/lib/services/task-transition-service";
import { getWebUserPreferencesState } from "@/lib/services/user-preferences-service";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const YESTERDAY_ROW_COLUMNS =
  "id, title, status, completed_at, project_id, projects(name, slug)";
const YESTERDAY_STATUSES = ["done", "complete", "completed"] as const;

/**
 * Seam for tests and for callers that already resolved the canonical Today
 * write use case. Defaults to the real `planTaskForToday`; it is deliberately a
 * single function, not a strategy/framework.
 */
export type MorningStartupPlanTask = (
  taskId: string,
  options: { supabase: SupabaseServerClient; now?: Date; localDate?: string },
) => Promise<{ errorMessage: string | null }>;

export type GetMorningStartupDataOptions = Readonly<{
  supabase?: SupabaseServerClient;
  now?: Date;
  preferences?: UserPreferences;
  preferencesErrorMessage?: string | null;
  skipped?: boolean;
  retryIds?: readonly string[];
}>;

export type StartMorningOutcomesOptions = Readonly<{
  taskIds: unknown;
  supabase?: SupabaseServerClient;
  now?: Date;
  localDate?: string;
  planTask?: MorningStartupPlanTask;
}>;

export type StartMorningOutcomesResult = Readonly<{
  errorMessage: string | null;
  appliedCount: number;
}>;

function normalizeProject(
  value: unknown,
): { name: string; slug: string; archivedAt: string | null } | null {
  if (Array.isArray(value)) {
    return normalizeProject(value[0]);
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : "";
  const slug = typeof record.slug === "string" ? record.slug : "";
  if (!name) return null;
  return {
    name,
    slug,
    archivedAt: typeof record.archived_at === "string" ? record.archived_at : null,
  };
}

function normalizeArchivedAt(value: unknown): string | null {
  if (Array.isArray(value)) {
    return normalizeArchivedAt(value[0]);
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  return typeof record.archived_at === "string" ? record.archived_at : null;
}

function isRelationPresent(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return Boolean(value && typeof value === "object");
}

/**
 * Read the bounded Morning Startup inputs for the canonical Today snapshot.
 *
 * The yesterday read is a request-scoped Supabase query (RLS is the owner
 * scope; no owner id is accepted from a caller). Its failure is non-fatal: the
 * returned model carries `yesterday.errorMessage` so Today still renders. The
 * exact count is independent of the capped row list.
 */
export async function getMorningStartupData(
  snapshot: OperatorSnapshot,
  options: GetMorningStartupDataOptions = {},
): Promise<MorningStartupModel> {
  const preferencesState = options.preferences
    ? {
        preferences: options.preferences,
        errorMessage: options.preferencesErrorMessage ?? null,
      }
    : await getWebUserPreferencesState().catch(() => ({
        preferences: DEFAULT_USER_PREFERENCES,
        errorMessage: MORNING_STARTUP_PREFERENCES_ERROR_MESSAGE,
      }));

  let yesterdayRows: MorningStartupYesterdayRow[] = [];
  let yesterdayCompletedCount: number | null = null;
  let yesterdayErrorMessage: string | null = null;

  try {
    const supabase = options.supabase ?? (await createClient());
    const yesterdayIso = shiftIsoDateByDays(snapshot.date, -1);
    const window = getLocalDayWindow(snapshot.timezone, yesterdayIso);

    const rowsResult = await supabase
      .from("tasks")
      .select(YESTERDAY_ROW_COLUMNS, { count: "exact" })
      .in("status", [...YESTERDAY_STATUSES])
      .gte("completed_at", window.startUtcIso)
      .lt("completed_at", window.endUtcIso)
      .order("completed_at", { ascending: false })
      .limit(20);

    if (rowsResult.error) {
      yesterdayErrorMessage = MORNING_STARTUP_YESTERDAY_ERROR_MESSAGE;
    } else {
      yesterdayRows = (rowsResult.data ?? []).map((row) => {
        const project = normalizeProject((row as { projects?: unknown }).projects);
        return {
          id: String(row.id),
          title: String(row.title ?? ""),
          projectName: project?.name ?? null,
          projectSlug: project?.slug ?? null,
          completedAt: row.completed_at ?? null,
        };
      });
      // The exact count travels with the same capped row query. Fall back to
      // the row length only when the count is unavailable.
      yesterdayCompletedCount = rowsResult.count ?? null;
    }
  } catch {
    yesterdayErrorMessage = MORNING_STARTUP_YESTERDAY_ERROR_MESSAGE;
  }

  return buildMorningStartupModel({
    snapshot,
    yesterdayRows,
    yesterdayCompletedCount,
    preferences: preferencesState.preferences,
    preferencesErrorMessage: preferencesState.errorMessage,
    date: snapshot.date,
    timezone: snapshot.timezone,
    skipped: options.skipped ?? false,
    retrySelectedIds: options.retryIds ?? [],
    yesterdayErrorMessage,
  });
}

/**
 * Plan the submitted outcome tasks for today through the canonical
 * `planTaskForToday` use case. Reads the owned rows first, validates status,
 * archive/ancestry and single-project rules, then writes `planned_for_date` in
 * submitted order. Any failure returns an actionable partial-failure message
 * and the applied count; it never returns a success-shaped result.
 */
export async function startMorningOutcomes(
  options: StartMorningOutcomesOptions,
): Promise<StartMorningOutcomesResult> {
  const normalized = normalizeOutcomeTaskIds(options.taskIds);
  if (!normalized.ok) {
    return { errorMessage: normalized.errorMessage, appliedCount: 0 };
  }

  const supabase = options.supabase ?? (await createClient());
  const planTask = options.planTask ?? planTaskForToday;

  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, status, archived_at, project_id, goal_id, projects(name, slug, archived_at), goals(archived_at)",
    )
    .in("id", normalized.taskIds);

  if (error) {
    return {
      errorMessage: "Unable to verify the selected outcome tasks right now.",
      appliedCount: 0,
    };
  }

  const rows: MorningStartupOwnedTaskRow[] = (data ?? []).map((row) => {
    const rawProjects = (row as { projects?: unknown }).projects;
    const rawGoals = (row as { goals?: unknown }).goals;
    const project = normalizeProject(rawProjects);
    return {
      id: String(row.id),
      status: String(row.status ?? ""),
      archivedAt: row.archived_at ?? null,
      projectId: String(row.project_id ?? ""),
      projectName: project?.name ?? null,
      projectSlug: project?.slug ?? null,
      projectArchivedAt: project?.archivedAt ?? null,
      goalId: row.goal_id ? String(row.goal_id) : null,
      goalArchivedAt: normalizeArchivedAt(rawGoals),
      projectRelationPresent: isRelationPresent(rawProjects),
      goalRelationPresent: isRelationPresent(rawGoals),
    };
  });

  const returnedIds = new Set(rows.map((row) => row.id));
  if (
    rows.length !== normalized.taskIds.length ||
    normalized.taskIds.some((id) => !returnedIds.has(id))
  ) {
    return { errorMessage: MORNING_OUTCOME_UNAVAILABLE_MESSAGE, appliedCount: 0 };
  }

  const validation = validateMorningOutcomeTasks(rows);
  if (!validation.ok) {
    return { errorMessage: validation.errorMessage, appliedCount: 0 };
  }

  const rowsById = new Map(validation.tasks.map((row) => [row.id, row]));
  const orderedTasks = normalized.taskIds.flatMap((id) => {
    const row = rowsById.get(id);
    return row ? [row] : [];
  });

  let appliedCount = 0;
  for (const task of orderedTasks) {
    let result: { errorMessage: string | null };
    try {
      result = await planTask(task.id, {
        supabase,
        now: options.now,
        localDate: options.localDate,
      });
    } catch {
      return {
        errorMessage: `Morning startup saved ${appliedCount} of ${orderedTasks.length} outcomes, then failed: Unable to update task right now.`,
        appliedCount,
      };
    }

    if (result.errorMessage) {
      return {
        errorMessage: `Morning startup saved ${appliedCount} of ${orderedTasks.length} outcomes, then failed: ${result.errorMessage}`,
        appliedCount,
      };
    }

    appliedCount += 1;
  }

  if (appliedCount === 0) {
    return { errorMessage: MORNING_OUTCOME_UNAVAILABLE_MESSAGE, appliedCount: 0 };
  }

  return { errorMessage: null, appliedCount };
}
