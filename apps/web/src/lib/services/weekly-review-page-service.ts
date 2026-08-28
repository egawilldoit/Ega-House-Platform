import { getReviewFormValuesFromRecord } from "@/app/review/review-form-state";
import { buildMostTrackedInsights, type MostTrackedInsights } from "@/lib/review-most-tracked";
import { getRecentDailyTrackedTime } from "@/lib/review-session-heatmap";
import { getWeekWindow } from "@/lib/review-week";
import { createClient } from "@/lib/supabase/server";
import { getTasksForReview } from "@/lib/services/task-read-service";
import { generateWeeklyReviewDraftForUser } from "@/lib/services/weekly-review-draft-service";
import { getWorkAnalyticsSessionsForWindow } from "@/lib/services/work-analytics-data-adapter";
import { calculateWorkAnalytics } from "@/lib/services/work-analytics-service";
import type { WeeklyReviewDraft } from "@/lib/weekly-review-generator";
import { resolveHistoricalTimeContext } from "@ega/application";
import { getWeekWindow as getDomainWeekWindow } from "@ega/domain";

const PAST_REVIEW_LIMIT = 100;

type ReviewPageSupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type WeeklyReviewPageDataParams = {
  ownerUserId: string;
  selectedWeekOf: string;
  useGeneratedDraft: boolean;
};

export type WeeklyStats = {
  tasksCreated: number;
  sessionsLogged: number;
  trackedSeconds: number;
  goalsTouched: number;
  goalStatusCounts: Array<{ status: string; count: number }>;
  blockedTasks: Array<{
    id: string;
    title: string;
    blockedReason: string | null;
    updatedAt: string;
  }>;
};

export type WeeklyReviewPageSelectedReview = {
  id: string;
  summary: string | null;
  wins: string | null;
  blockers: string | null;
  next_steps: string | null;
  created_at: string;
  updated_at: string | null;
};

export type WeeklyReviewPageFormDefaults = {
  summary: string;
  wins: string;
  blockers: string;
  nextSteps: string;
  weekOf: string;
};

export type WeeklyReviewPageData = {
  bounds: {
    weekStart: string;
    weekEnd: string;
  };
  pastReviews: Array<{
    id: string;
    week_start: string;
    week_end: string;
    summary: string | null;
    created_at: string;
    updated_at: string | null;
  }>;
  selectedReview: WeeklyReviewPageSelectedReview | null;
  weeklyStats: WeeklyStats;
  sessionHeatmap: Awaited<ReturnType<typeof getRecentDailyTrackedTime>>;
  mostTrackedInsights: MostTrackedInsights;
  generatedDraft: WeeklyReviewDraft;
  reviewFormDefaults: WeeklyReviewPageFormDefaults;
};

export function resolveWeeklyReviewPageFormDefaults({
  generatedDraft,
  selectedReview,
  selectedWeekOf,
  useGeneratedDraft,
}: {
  generatedDraft: WeeklyReviewDraft;
  selectedReview: WeeklyReviewPageSelectedReview | null;
  selectedWeekOf: string;
  useGeneratedDraft: boolean;
}): WeeklyReviewPageFormDefaults {
  return useGeneratedDraft || !selectedReview
    ? {
        ...generatedDraft,
        weekOf: selectedWeekOf,
      }
    : getReviewFormValuesFromRecord(selectedReview, selectedWeekOf);
}

async function getPastReviews(supabase: ReviewPageSupabaseClient, ownerUserId: string) {
  const { data, error } = await supabase
    .from("week_reviews")
    .select("id, week_start, week_end, summary, created_at, updated_at")
    .eq("owner_user_id", ownerUserId)
    .order("week_start", { ascending: false })
    .limit(PAST_REVIEW_LIMIT);

  if (error) {
    throw new Error(`Failed to load reviews: ${error.message}`);
  }

  return data ?? [];
}

async function getSelectedWeekReview(
  supabase: ReviewPageSupabaseClient,
  weekStart: string,
  weekEnd: string,
  ownerUserId: string,
) {
  const { data, error } = await supabase
    .from("week_reviews")
    .select("id, summary, wins, blockers, next_steps, created_at, updated_at")
    .eq("owner_user_id", ownerUserId)
    .eq("week_start", weekStart)
    .eq("week_end", weekEnd)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to load selected week reviews: ${error.message}`);
  }

  return data?.[0] ?? null;
}

async function getUserTimezoneForReview(
  supabase: ReviewPageSupabaseClient,
  ownerUserId: string,
): Promise<string | null> {
  try {
    const { data } = await (supabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (a: string, b: string) => { maybeSingle: () => Promise<{ data: { iana_timezone?: string | null } | null }> } } } }).from(
      "user_time_context",
    )
      .select("iana_timezone")
      .eq("user_id", ownerUserId)
      .maybeSingle();
    const tz = (data as { iana_timezone?: string | null } | null)?.iana_timezone;
    return typeof tz === "string" && tz.trim() ? tz.trim() : null;
  } catch {
    return null;
  }
}

function isValidWindowIso(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function resolveWeeklyWindow(
  weekStart: string,
  weekEnd: string,
  timezone: string | null,
): { startIso: string; endExclusiveIso: string } {
  // Canonical via resolveHistoricalTimeContext — historical reproducibility and DST-aware.
  const tz = timezone ?? "UTC";
  try {
    const result = resolveHistoricalTimeContext({ timezone: tz, date: weekStart });
    if (result.ok) {
      // result's weekWindow is for the week containing weekStart; weekStart/weekEnd are Monday/Sunday of that week,
      // so weekStart's window should match week bounds. Use domain directly for explicit weekStart/weekEnd pair.
      const startWindow = getDomainWeekWindow(tz, weekStart);
      const domainEnd = getDomainWeekWindow(tz, weekEnd);
      const candidate = { startIso: startWindow.weekStartUtcIso, endExclusiveIso: domainEnd.weekEndExclusiveUtcIso };
      if (isValidWindowIso(candidate.startIso) && isValidWindowIso(candidate.endExclusiveIso)) return candidate;
    }
  } catch {}
  // Fallback to UTC legacy helper
  const fallback = getWeekWindow(weekStart, weekEnd);
  if (!isValidWindowIso(fallback.startIso) || !isValidWindowIso(fallback.endExclusiveIso)) {
    throw new Error("Invalid window for weekly review.");
  }
  return fallback;
}

async function getWeeklyStats(
  supabase: ReviewPageSupabaseClient,
  weekStart: string,
  weekEnd: string,
  ownerUserId: string,
  timezone: string | null,
): Promise<WeeklyStats> {
  const { startIso, endExclusiveIso } = resolveWeeklyWindow(weekStart, weekEnd, timezone);
  const nowIso = new Date().toISOString();
  const sessionNowIso = nowIso < endExclusiveIso ? nowIso : endExclusiveIso;
  const [tasksResult, sessionsResult, goalsResult, blockedTasksResult, analyticsSessionsResult] = await Promise.all([
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("owner_user_id", ownerUserId)
      .gte("created_at", startIso)
      .lt("created_at", endExclusiveIso),
    supabase
      .from("task_sessions")
      .select("id, task_id, started_at, ended_at, duration_seconds")
      .eq("owner_user_id", ownerUserId)
      .gte("started_at", startIso)
      .lt("started_at", endExclusiveIso),
    supabase
      .from("goals")
      .select("id, status")
      .eq("owner_user_id", ownerUserId)
      .gte("updated_at", startIso)
      .lt("updated_at", endExclusiveIso),
    getTasksForReview({ supabase, ownerUserId, limit: 6 }),
    getWorkAnalyticsSessionsForWindow({
      ownerUserId,
      supabase,
      window: { startIso, endIso: endExclusiveIso },
    }),
  ]);

  if (tasksResult.error) {
    throw new Error(`Failed to load weekly task stats: ${tasksResult.error.message}`);
  }
  if (sessionsResult.error) {
    throw new Error(`Failed to load weekly session stats: ${sessionsResult.error.message}`);
  }
  if (goalsResult.error) {
    throw new Error(`Failed to load weekly goal stats: ${goalsResult.error.message}`);
  }
  if (blockedTasksResult.errorMessage) {
    throw new Error(`Failed to load blocked tasks: ${blockedTasksResult.errorMessage}`);
  }
  if (analyticsSessionsResult.errorMessage || !analyticsSessionsResult.data) {
    throw new Error(analyticsSessionsResult.errorMessage ?? "Failed to load weekly analytics sessions.");
  }

  const analyticsPeriod = calculateWorkAnalytics(
    analyticsSessionsResult.data,
    { startIso, endIso: endExclusiveIso },
    { nowIso: sessionNowIso },
  );
  const trackedSeconds = analyticsPeriod.totalWorkedMinutes * 60;
  const goalStatusCounts = Array.from(
    (goalsResult.data ?? []).reduce<Map<string, number>>((counts, goal) => {
      counts.set(goal.status, (counts.get(goal.status) ?? 0) + 1);
      return counts;
    }, new Map()),
  )
    .map(([status, count]) => ({ status, count }))
    .sort((left, right) => right.count - left.count || left.status.localeCompare(right.status))
    .slice(0, 3);

  return {
    tasksCreated: tasksResult.count ?? 0,
    sessionsLogged: sessionsResult.data?.length ?? 0,
    trackedSeconds,
    goalsTouched: goalsResult.data?.length ?? 0,
    goalStatusCounts,
    blockedTasks: (blockedTasksResult.data ?? []).map((task) => ({
      id: task.id,
      title: task.title,
      blockedReason: task.blocked_reason,
      updatedAt: task.updated_at,
    })),
  };
}

async function getMostTrackedInsights(
  supabase: ReviewPageSupabaseClient,
  weekStart: string,
  weekEnd: string,
  ownerUserId: string,
  timezone: string | null,
): Promise<MostTrackedInsights> {
  const { startIso, endExclusiveIso } = resolveWeeklyWindow(weekStart, weekEnd, timezone);
  if (!isValidWindowIso(startIso) || !isValidWindowIso(endExclusiveIso)) {
    throw new Error("Invalid window for most tracked insights.");
  }
  const { data, error } = await supabase
    .from("task_sessions")
    .select(
      "task_id, started_at, ended_at, duration_seconds, tasks(id, title, projects(id, name, slug), goals(id, title))",
    )
    .eq("owner_user_id", ownerUserId)
    .lt("started_at", endExclusiveIso)
    .or(`ended_at.is.null,ended_at.gte.${startIso}`);

  if (error) {
    throw new Error(`Failed to load most tracked insights: ${error.message}`);
  }

  return buildMostTrackedInsights(data ?? [], {
    startIso,
    endIso: endExclusiveIso,
  });
}

export async function getWeeklyReviewPageData({
  ownerUserId,
  selectedWeekOf,
  useGeneratedDraft,
}: WeeklyReviewPageDataParams): Promise<WeeklyReviewPageData> {
  const supabase = await createClient();
  const timezone = await getUserTimezoneForReview(supabase, ownerUserId);
  // Canonical historical window via resolveHistoricalTimeContext (timezone-aware, DST-aware, reproducible)
  const historical = resolveHistoricalTimeContext({ timezone: timezone ?? "UTC", date: selectedWeekOf });
  if (!historical.ok) {
    throw new Error("Failed to resolve selected week.");
  }
  const bounds = {
    weekStart: historical.data.weekWindow.weekStart,
    weekEnd: historical.data.weekWindow.weekEnd,
  };

  const [pastReviews, selectedReview, weeklyStats, sessionHeatmap, mostTrackedInsights, generatedDraft] =
    await Promise.all([
      getPastReviews(supabase, ownerUserId),
      getSelectedWeekReview(supabase, bounds.weekStart, bounds.weekEnd, ownerUserId),
      getWeeklyStats(supabase, bounds.weekStart, bounds.weekEnd, ownerUserId, timezone),
      getRecentDailyTrackedTime(supabase, { ownerUserId, timezone: timezone ?? "UTC" }),
      getMostTrackedInsights(supabase, bounds.weekStart, bounds.weekEnd, ownerUserId, timezone),
      generateWeeklyReviewDraftForUser({
        supabase,
        ownerUserId,
        weekStart: bounds.weekStart,
        weekEnd: bounds.weekEnd,
      }),
    ]);

  const reviewFormDefaults = resolveWeeklyReviewPageFormDefaults({
    generatedDraft,
    selectedReview,
    selectedWeekOf,
    useGeneratedDraft,
  });

  return {
    bounds,
    pastReviews,
    selectedReview,
    weeklyStats,
    sessionHeatmap,
    mostTrackedInsights,
    generatedDraft,
    reviewFormDefaults,
  };
}
