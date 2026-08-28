/**
 * Weekly Review Page Service — canonical delegation.
 * This service preserves the existing web import path (so review/page.tsx
 * remains compatible) but delegates all business semantics to the shared
 * @ega/application Weekly Review read model. No duplication of week bounds,
 * execution evidence, or draft generation remains here.
 */

import { getReviewFormValuesFromRecord } from "@/app/review/review-form-state";
import type { MostTrackedInsights } from "@/lib/review-most-tracked";
import { getRecentDailyTrackedTime, type DailyTrackedTime } from "@/lib/review-session-heatmap";
import { createClient } from "@/lib/supabase/server";
import { createAuthenticatedActor } from "@ega/application/auth/actor";
import { getWeeklyReviewReadModel, resolveWeeklyReviewFormDefaults } from "@ega/application/weekly-review/read-model";
import {
  SupabaseWeeklyReviewRepository,
  SupabaseWeeklyReviewTaskRepository,
  SupabaseExecutionEvidenceRepository,
  SupabaseTimeContextRepository,
} from "@ega/data-access";
import type { WeeklyReviewDraft } from "@/lib/weekly-review-generator";

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
  sessionHeatmap: DailyTrackedTime[];
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
  // Thin wrapper that delegates to canonical helper for backward compatibility.
  const mappedSaved = selectedReview
    ? {
        id: selectedReview.id,
        weekStart: "",
        weekEnd: "",
        summary: selectedReview.summary,
        wins: selectedReview.wins,
        blockers: selectedReview.blockers,
        nextSteps: selectedReview.next_steps,
        createdAt: selectedReview.created_at,
        updatedAt: selectedReview.updated_at,
        officialEmailStatus: null,
        officialEmailSentAt: null,
      }
    : null;
  const result = resolveWeeklyReviewFormDefaults(
    generatedDraft as unknown as { summary: string; wins: string; blockers: string; nextSteps: string },
    mappedSaved,
    selectedWeekOf,
    useGeneratedDraft,
  );
  return result as WeeklyReviewPageFormDefaults;
}

export async function getWeeklyReviewPageData({
  ownerUserId,
  selectedWeekOf,
  useGeneratedDraft,
}: WeeklyReviewPageDataParams): Promise<WeeklyReviewPageData> {
  const actor = createAuthenticatedActor(ownerUserId);
  const supabase = await createClient();

  const [result, sessionHeatmap] = await Promise.all([
    getWeeklyReviewReadModel(
      actor,
      {
        timeContext: new SupabaseTimeContextRepository(supabase as unknown as import("@supabase/supabase-js").SupabaseClient),
        weeklyReview: new SupabaseWeeklyReviewRepository(supabase as unknown as import("@supabase/supabase-js").SupabaseClient),
        weeklyTasks: new SupabaseWeeklyReviewTaskRepository(supabase as unknown as import("@supabase/supabase-js").SupabaseClient),
        executionEvidence: new SupabaseExecutionEvidenceRepository(supabase as unknown as import("@supabase/supabase-js").SupabaseClient),
      },
      { weekOf: selectedWeekOf },
    ),
    getRecentDailyTrackedTime(supabase, { ownerUserId }),
  ]);

  if (!result.ok) {
    throw new Error(result.errorMessage);
  }

  const model = result.data;

  // Map pastReviews to legacy shape (subset)
  const pastReviews = model.pastReviews.map((row) => ({
    id: row.id,
    week_start: row.weekStart,
    week_end: row.weekEnd,
    summary: row.summary,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }));

  const selectedReview: WeeklyReviewPageSelectedReview | null = model.savedReview
    ? {
        id: model.savedReview.id,
        summary: model.savedReview.summary,
        wins: model.savedReview.wins,
        blockers: model.savedReview.blockers,
        next_steps: model.savedReview.nextSteps,
        created_at: model.savedReview.createdAt,
        updated_at: model.savedReview.updatedAt,
      }
    : null;

  const weeklyStats: WeeklyStats = {
    tasksCreated: model.stats.tasksCreated,
    sessionsLogged: model.stats.sessionsLogged,
    trackedSeconds: model.stats.trackedSeconds,
    goalsTouched: model.stats.goalsTouched,
    goalStatusCounts: model.stats.goalStatusCounts,
    blockedTasks: model.stats.blockedTasks,
  };

  // Session heatmap is a 28-day trailing view (independent of selected week)
  // Delegates to shared execution-evidence via getRecentDailyTrackedTime.

  const mostTrackedInsights: MostTrackedInsights = {
    tasks: model.mostTracked.tasks.map((row) => ({
      id: row.id,
      label: row.label,
      href: row.href,
      trackedSeconds: row.trackedSeconds,
      trackedLabel: row.trackedLabel,
      sessionCount: row.sessionCount,
      detail: row.detail,
    })),
    projects: model.mostTracked.projects.map((row) => ({
      id: row.id,
      label: row.label,
      href: row.href,
      trackedSeconds: row.trackedSeconds,
      trackedLabel: row.trackedLabel,
      sessionCount: row.sessionCount,
      detail: row.detail,
    })),
    goals: model.mostTracked.goals.map((row) => ({
      id: row.id,
      label: row.label,
      href: row.href,
      trackedSeconds: row.trackedSeconds,
      trackedLabel: row.trackedLabel,
      sessionCount: row.sessionCount,
      detail: row.detail,
    })),
  };

  const generatedDraft: WeeklyReviewDraft = {
    summary: model.generatedDraft.summary,
    wins: model.generatedDraft.wins,
    blockers: model.generatedDraft.blockers,
    nextSteps: model.generatedDraft.nextSteps,
  };

  const reviewFormDefaults = resolveWeeklyReviewFormDefaults(
    generatedDraft as unknown as { summary: string; wins: string; blockers: string; nextSteps: string },
    model.savedReview,
    selectedWeekOf,
    useGeneratedDraft,
  ) as WeeklyReviewPageFormDefaults;

  return {
    bounds: {
      weekStart: model.window.weekStart,
      weekEnd: model.window.weekEnd,
    },
    pastReviews,
    selectedReview,
    weeklyStats,
    sessionHeatmap,
    mostTrackedInsights,
    generatedDraft,
    reviewFormDefaults,
  };
}
