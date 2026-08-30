import { getReviewFormValuesFromRecord } from "@/app/review/review-form-state";
import type { MostTrackedInsights } from "@/lib/review-most-tracked";
import { getDailyTrackedWindow, getRecentDailyTrackedTime } from "@/lib/review-session-heatmap";
import { createClient } from "@/lib/supabase/server";
import type { WeeklyReviewDraft } from "@/lib/weekly-review-generator";
import { createAuthenticatedActor, getWeeklyReviewReadModel } from "@ega/application";
import {
  SupabaseExecutionEvidenceRepository,
  SupabaseTimeContextRepository,
  SupabaseWeeklyReviewRepository,
  SupabaseWeeklyReviewTaskRepository,
} from "@ega/data-access";
import type { SupabaseClient } from "@supabase/supabase-js";

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

/**
 * Shared read-model adapter: web delegates all business evidence semantics
 * (saved review, Task/session/Goal/blocker stats, tracked summary, most-tracked,
 * generated draft, week boundaries) to the canonical getWeeklyReviewReadModel.
 * Web-specific concerns remain: form defaults, heatmap window, presentation mapping.
 * Business semantics are not duplicated.
 */
export async function getWeeklyReviewPageData({
  ownerUserId,
  selectedWeekOf,
  useGeneratedDraft,
}: WeeklyReviewPageDataParams): Promise<WeeklyReviewPageData> {
  const supabase = await createClient();
  const actor = createAuthenticatedActor(ownerUserId);

  const timeContext = new SupabaseTimeContextRepository(supabase as unknown as SupabaseClient);
  const weeklyReview = new SupabaseWeeklyReviewRepository(supabase as unknown as SupabaseClient);
  const weeklyTasks = new SupabaseWeeklyReviewTaskRepository(supabase as unknown as SupabaseClient);
  const executionEvidence = new SupabaseExecutionEvidenceRepository(supabase as unknown as SupabaseClient);

  const result = await getWeeklyReviewReadModel(
    actor,
    { timeContext, weeklyReview, weeklyTasks, executionEvidence },
    { weekOf: selectedWeekOf },
  );

  if (!result.ok) {
    throw new Error(result.errorMessage);
  }

  const data = result.data;
  const bounds = {
    weekStart: data.window.weekStart,
    weekEnd: data.window.weekEnd,
  };

  // Historical heatmap: selected week + canonical timezone → exact historical window → heatmap
  // Not from now / current recent period. Uses getDailyTrackedWindow (timezone-aware, DST-aware).
  const heatmapWindow = getDailyTrackedWindow(7, data.window.weekEnd, data.window.timezone);
  const sessionHeatmap = await getRecentDailyTrackedTime(supabase as unknown as ReviewPageSupabaseClient, {
    ownerUserId,
    window: heatmapWindow,
  });

  const mostTrackedInsights = data.mostTracked as unknown as MostTrackedInsights;

  const pastReviews = data.pastReviews.map((row) => ({
    id: row.id,
    week_start: row.weekStart,
    week_end: row.weekEnd,
    summary: row.summary,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }));

  const selectedReview: WeeklyReviewPageSelectedReview | null = data.savedReview
    ? {
        id: data.savedReview.id,
        summary: data.savedReview.summary,
        wins: data.savedReview.wins,
        blockers: data.savedReview.blockers,
        next_steps: data.savedReview.nextSteps,
        created_at: data.savedReview.createdAt,
        updated_at: data.savedReview.updatedAt,
      }
    : null;

  const weeklyStats: WeeklyStats = {
    tasksCreated: data.stats.tasksCreated,
    sessionsLogged: data.stats.sessionsLogged,
    trackedSeconds: data.stats.trackedSeconds,
    goalsTouched: data.stats.goalsTouched,
    goalStatusCounts: data.stats.goalStatusCounts,
    blockedTasks: data.stats.blockedTasks.map((task) => ({
      id: task.id,
      title: task.title,
      blockedReason: task.blockedReason,
      updatedAt: task.updatedAt,
    })),
  };

  const generatedDraft = data.generatedDraft as unknown as WeeklyReviewDraft;

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
