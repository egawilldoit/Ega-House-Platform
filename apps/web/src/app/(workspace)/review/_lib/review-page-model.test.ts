import { describe, expect, it, vi } from "vitest";

const getWeeklyReviewPageData = vi.hoisted(() =>
  vi.fn(async () => ({
    bounds: { weekStart: "2026-10-13", weekEnd: "2026-10-19" },
    pastReviews: [],
    selectedReview: null,
    weeklyStats: {
      tasksCreated: 0,
      sessionsLogged: 0,
      trackedSeconds: 0,
      goalsTouched: 0,
      goalStatusCounts: [],
      blockedTasks: [],
    },
    sessionHeatmap: [],
    mostTrackedInsights: { tasks: [], projects: [], goals: [] },
    estimateAccuracy: {
      taskCount: 0,
      estimatedTaskCount: 0,
      trackedTaskCount: 0,
      estimateMinutes: 0,
      trackedSeconds: 0,
      trackedSecondsOnAllTasks: 0,
      comparison: null,
      overTaskCount: 0,
      underTaskCount: 0,
      onTargetTaskCount: 0,
      evaluatedTaskCount: 0,
      onTargetEvaluatedTaskCount: 0,
      accuracyPercent: null,
      topOverRuns: [],
      hasOpenSessions: false,
    },
    generatedDraft: { summary: "", wins: "", blockers: "", nextSteps: "" },
    reviewFormDefaults: { summary: "", wins: "", blockers: "", nextSteps: "", weekOf: "2026-10-13" },
  })),
);

const getWebTimeContext = vi.hoisted(() =>
  vi.fn(async () => ({
    timezone: "Africa/Casablanca",
    persistedTimezone: "Africa/Casablanca",
    fallback: "none",
    localDate: "2026-10-14",
  })),
);

const createClient = vi.hoisted(() =>
  vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })) },
  })),
);

vi.mock("@/lib/services/weekly-review-page-service", () => ({ getWeeklyReviewPageData }));
vi.mock("@/lib/services/time-context-service", () => ({ getWebTimeContext }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

import { getReviewPageModel } from "./review-page-model";

describe("getReviewPageModel timezone threading", () => {
  it("uses the validated effective timezone as model.timezone", async () => {
    const model = await getReviewPageModel({});
    expect(model.timezone).toBe("Africa/Casablanca");
  });

  it("falls back to UTC when the persisted timezone is invalid", async () => {
    getWebTimeContext.mockResolvedValueOnce({
      timezone: "UTC",
      persistedTimezone: "Not/A_Timezone",
      fallback: "invalid_timezone",
      localDate: "2026-10-14",
    });
    const model = await getReviewPageModel({});
    expect(model.timezone).toBe("UTC");
  });
});
