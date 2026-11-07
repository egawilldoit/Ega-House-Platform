import type { OperatorSnapshot } from "@ega/application";
import { getLocalDayWindow } from "@ega/domain";
import { DEFAULT_USER_PREFERENCES, type UserPreferences } from "@ega/domain/preferences";

import {
  buildMorningStartupModel,
  MORNING_OUTCOME_UNAVAILABLE_MESSAGE,
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
import { getWebUserPreferences } from "@/lib/services/user-preferences-service";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

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
  skipped?: boolean;
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

function normalizeProject(value: unknown): { name: string; slug: string } | null {
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
  return { name, slug };
}

/**
 * Read the bounded Morning Startup inputs for the canonical Today snapshot.
 *
 * The yesterday read is a request-scoped Supabase query (RLS is the owner
 * scope; no owner id is accepted from a caller). Its failure is non-fatal: the
 * returned model carries `yesterday.errorMessage` so Today still renders.
 */
export async function getMorningStartupData(
  snapshot: OperatorSnapshot,
  options: GetMorningStartupDataOptions = {},
): Promise<MorningStartupModel> {
  const preferences =
    options.preferences ?? (await getWebUserPreferences().catch(() => DEFAULT_USER_PREFERENCES));

  let yesterdayRows: MorningStartupYesterdayRow[] = [];
  let yesterdayErrorMessage: string | null = null;

  try {
    const supabase = options.supabase ?? (await createClient());
    const yesterdayIso = shiftIsoDateByDays(snapshot.date, -1);
    const window = getLocalDayWindow(snapshot.timezone, yesterdayIso);

    const { data, error } = await supabase
      .from("tasks")
      .select("id, title, status, completed_at, project_id, projects(name, slug)")
      .eq("status", "done")
      .gte("completed_at", window.startUtcIso)
      .lt("completed_at", window.endUtcIso)
      .order("completed_at", { ascending: false })
      .limit(20);

    if (error) {
      yesterdayErrorMessage = MORNING_STARTUP_YESTERDAY_ERROR_MESSAGE;
    } else {
      yesterdayRows = (data ?? []).map((row) => {
        const project = normalizeProject((row as { projects?: unknown }).projects);
        return {
          id: String(row.id),
          title: String(row.title ?? ""),
          projectName: project?.name ?? null,
          projectSlug: project?.slug ?? null,
          completedAt: row.completed_at ?? null,
        };
      });
    }
  } catch {
    yesterdayErrorMessage = MORNING_STARTUP_YESTERDAY_ERROR_MESSAGE;
  }

  return buildMorningStartupModel({
    snapshot,
    yesterdayRows,
    preferences,
    date: snapshot.date,
    timezone: snapshot.timezone,
    skipped: options.skipped ?? false,
    yesterdayErrorMessage,
  });
}

/**
 * Plan the submitted outcome tasks for today through the canonical
 * `planTaskForToday` use case. Reads the owned rows first, validates status,
 * archive and single-project rules, then writes `planned_for_date` in submitted
 * order. Any failure returns an actionable partial-failure message and the
 * applied count; it never returns a success-shaped result.
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
    .select("id, status, archived_at, project_id, projects(name, slug)")
    .in("id", normalized.taskIds);

  if (error) {
    return {
      errorMessage: "Unable to verify the selected outcome tasks right now.",
      appliedCount: 0,
    };
  }

  const rows: MorningStartupOwnedTaskRow[] = (data ?? []).map((row) => {
    const project = normalizeProject((row as { projects?: unknown }).projects);
    return {
      id: String(row.id),
      status: String(row.status ?? ""),
      archivedAt: row.archived_at ?? null,
      projectId: String(row.project_id ?? ""),
      projectName: project?.name ?? null,
      projectSlug: project?.slug ?? null,
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
    const result = await planTask(task.id, {
      supabase,
      now: options.now,
      localDate: options.localDate,
    });

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
