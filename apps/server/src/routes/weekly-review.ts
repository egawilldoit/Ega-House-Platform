import { Hono } from "hono";

import { getWeeklyReviewReadModel } from "@ega/application/weekly-review/read-model";
import {
  SupabaseExecutionEvidenceRepository,
  SupabaseTimeContextRepository,
  SupabaseWeeklyReviewRepository,
  SupabaseWeeklyReviewTaskRepository,
} from "@ega/data-access";

import type { ServerDependencies, ServerVariables } from "../app";

export function createWeeklyReviewRoutes(
  dependencies: ServerDependencies,
): Hono<{ Variables: ServerVariables }> {
  const routes = new Hono<{ Variables: ServerVariables }>();

  routes.get("/", async (c) => {
    const { actor, client } = c.var;
    const weekOf = c.req.query("weekOf");

    const result = await getWeeklyReviewReadModel(
      actor,
      {
        timeContext: new SupabaseTimeContextRepository(client),
        weeklyReview: new SupabaseWeeklyReviewRepository(client),
        weeklyTasks: new SupabaseWeeklyReviewTaskRepository(client),
        executionEvidence: new SupabaseExecutionEvidenceRepository(client),
      },
      { weekOf, now: dependencies.now?.() },
    );

    if (!result.ok) {
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }

    // Map domain/Application model to contract DTO
    const data = result.data;

    // Convert Maps to Records for DTO
    const evidenceDto = {
      window: data.evidence.window,
      totalTrackedSeconds: data.evidence.totalTrackedSeconds,
      trackedSecondsByTask: Object.fromEntries(data.evidence.trackedSecondsByTask.entries()),
      trackedSecondsByProject: Object.fromEntries(data.evidence.trackedSecondsByProject.entries()),
      trackedSecondsByGoal: Object.fromEntries(data.evidence.trackedSecondsByGoal.entries()),
      trackedSecondsByDay: Object.fromEntries(data.evidence.trackedSecondsByDay.entries()),
      taskTimeBuckets: data.evidence.taskTimeBuckets,
      projectTimeBuckets: data.evidence.projectTimeBuckets,
      goalTimeBuckets: data.evidence.goalTimeBuckets,
      dayTimeBuckets: data.evidence.dayTimeBuckets,
      touchedProjectNames: data.evidence.touchedProjectNames,
      touchedGoalTitles: data.evidence.touchedGoalTitles,
      sessionCount: data.evidence.sessionCount,
      openSessionCount: data.evidence.openSessionCount,
      malformedCount: data.evidence.malformedCount,
      quality: data.evidence.quality,
      transitions: data.evidence.transitions,
    };

    const payload = {
      ok: true as const,
      review: {
        window: data.window,
        savedReview: data.savedReview
          ? {
              id: data.savedReview.id,
              weekStart: data.savedReview.weekStart,
              weekEnd: data.savedReview.weekEnd,
              summary: data.savedReview.summary,
              wins: data.savedReview.wins,
              blockers: data.savedReview.blockers,
              nextSteps: data.savedReview.nextSteps,
              createdAt: data.savedReview.createdAt,
              updatedAt: data.savedReview.updatedAt,
              officialEmailStatus: data.savedReview.officialEmailStatus,
              officialEmailSentAt: data.savedReview.officialEmailSentAt,
            }
          : null,
        pastReviews: data.pastReviews.map((row) => ({
          id: row.id,
          weekStart: row.weekStart,
          weekEnd: row.weekEnd,
          summary: row.summary,
          wins: row.wins,
          blockers: row.blockers,
          nextSteps: row.nextSteps,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          officialEmailStatus: row.officialEmailStatus,
          officialEmailSentAt: row.officialEmailSentAt,
        })),
        stats: data.stats,
        evidence: evidenceDto,
        mostTracked: data.mostTracked,
        generatedDraft: data.generatedDraft,
      },
    };

    return c.json(payload);
  });

  return routes;
}
