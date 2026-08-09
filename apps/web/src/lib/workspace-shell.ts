import { createClient } from "@/lib/supabase/server";
import { getWeekBounds, getTodayIsoDate } from "@/lib/review-week";
import { getTodayLocalIsoDate } from "@/lib/task-due-date";

export type WorkspaceShellPrioritySignal =
  | "active_timer"
  | "overdue"
  | "due_today"
  | "blocked"
  | "review_missing"
  | "clear";

export type WorkspaceShellMetricsSnapshot = {
  hasActiveTimer: boolean;
  blockedTaskCount: number;
  overdueTaskCount: number;
  dueTodayTaskCount: number;
  hasCurrentWeekReview: boolean;
};

export type WorkspaceShellMetrics = {
  hasActiveTimer: boolean;
  timerState: "active" | "idle";
  blockedTaskCount: number;
  overdueTaskCount: number;
  dueTodayTaskCount: number;
  reviewMissing: boolean;
  reviewSignal: "missing" | "current";
  taskActionCount: number;
  totalActionCount: number;
  highestPrioritySignal: WorkspaceShellPrioritySignal;
};

const FALLBACK_WORKSPACE_SHELL_SNAPSHOT: WorkspaceShellMetricsSnapshot = {
  hasActiveTimer: false,
  blockedTaskCount: 0,
  overdueTaskCount: 0,
  dueTodayTaskCount: 0,
  hasCurrentWeekReview: true,
};

function toSafeCount(value: number | null | undefined) {
  return Math.max(0, value ?? 0);
}

function isNextDynamicServerError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    error.digest === "DYNAMIC_SERVER_USAGE"
  );
}

export function buildWorkspaceShellMetrics(
  snapshot: WorkspaceShellMetricsSnapshot,
): WorkspaceShellMetrics {
  const blockedTaskCount = toSafeCount(snapshot.blockedTaskCount);
  const overdueTaskCount = toSafeCount(snapshot.overdueTaskCount);
  const dueTodayTaskCount = toSafeCount(snapshot.dueTodayTaskCount);
  const hasActiveTimer = Boolean(snapshot.hasActiveTimer);
  const reviewMissing = !snapshot.hasCurrentWeekReview;
  const taskActionCount = blockedTaskCount + overdueTaskCount + dueTodayTaskCount;

  let highestPrioritySignal: WorkspaceShellPrioritySignal = "clear";
  if (hasActiveTimer) {
    highestPrioritySignal = "active_timer";
  } else if (overdueTaskCount > 0) {
    highestPrioritySignal = "overdue";
  } else if (dueTodayTaskCount > 0) {
    highestPrioritySignal = "due_today";
  } else if (blockedTaskCount > 0) {
    highestPrioritySignal = "blocked";
  } else if (reviewMissing) {
    highestPrioritySignal = "review_missing";
  }

  return {
    hasActiveTimer,
    timerState: hasActiveTimer ? "active" : "idle",
    blockedTaskCount,
    overdueTaskCount,
    dueTodayTaskCount,
    reviewMissing,
    reviewSignal: reviewMissing ? "missing" : "current",
    taskActionCount,
    totalActionCount: taskActionCount + (hasActiveTimer ? 1 : 0) + (reviewMissing ? 1 : 0),
    highestPrioritySignal,
  };
}

async function getCountOrThrow(
  queryPromise: PromiseLike<{ count: number | null; error: { message: string } | null }>,
  message: string,
) {
  const { count, error } = await queryPromise;
  if (error) {
    throw new Error(message);
  }

  return count ?? 0;
}

async function getActiveTaskCountOrThrow(
  buildQuery: (includeArchiveFilter: boolean) => PromiseLike<{
    count: number | null;
    error: { message: string } | null;
  }>,
  message: string,
) {
  const result = await buildQuery(true);

  if (!result.error) {
    return result.count ?? 0;
  }

  return getCountOrThrow(buildQuery(false), message);
}

export async function getWorkspaceShellMetrics(): Promise<WorkspaceShellMetrics> {
  try {
    const supabase = await createClient();
    const today = getTodayLocalIsoDate();
    const reviewWeek = getWeekBounds(getTodayIsoDate());

    if (!reviewWeek) {
      throw new Error("Failed to resolve current review week.");
    }

    const [
      activeTimerResult,
      blockedTaskCount,
      overdueTaskCount,
      dueTodayTaskCount,
      currentWeekReviewResult,
    ] = await Promise.all([
      supabase
        .from("task_sessions")
        .select("id")
        .is("ended_at", null)
        .limit(1),
      getCountOrThrow(
        supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("status", "blocked")
          .is("archived_at", null),
        "Failed to load blocked task count.",
      ),
      getActiveTaskCountOrThrow(
        (includeArchiveFilter) => {
          const query = supabase
            .from("tasks")
            .select("id", { count: "exact", head: true })
            .neq("status", "done")
            .lt("due_date", today);

          return includeArchiveFilter ? query.is("archived_at", null) : query;
        },
        "Failed to load overdue task count.",
      ),
      getActiveTaskCountOrThrow(
        (includeArchiveFilter) => {
          const query = supabase
            .from("tasks")
            .select("id", { count: "exact", head: true })
            .neq("status", "done")
            .eq("due_date", today);

          return includeArchiveFilter ? query.is("archived_at", null) : query;
        },
        "Failed to load due-today task count.",
      ),
      supabase
        .from("week_reviews")
        .select("id")
        .eq("week_start", reviewWeek.weekStart)
        .eq("week_end", reviewWeek.weekEnd)
        .limit(1),
    ]);

    if (activeTimerResult.error) {
      throw new Error(`Failed to load active timer state: ${activeTimerResult.error.message}`);
    }

    if (currentWeekReviewResult.error) {
      throw new Error(
        `Failed to load current review state: ${currentWeekReviewResult.error.message}`,
      );
    }

    return buildWorkspaceShellMetrics({
      hasActiveTimer: Boolean(activeTimerResult.data?.length),
      blockedTaskCount,
      overdueTaskCount,
      dueTodayTaskCount,
      hasCurrentWeekReview: Boolean(currentWeekReviewResult.data?.length),
    });
  } catch (error) {
    if (isNextDynamicServerError(error)) {
      throw error;
    }

    console.warn("Workspace shell metrics unavailable; using neutral fallback.", error);
    return buildWorkspaceShellMetrics(FALLBACK_WORKSPACE_SHELL_SNAPSHOT);
  }
}
