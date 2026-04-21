import assert from "node:assert/strict";
import test from "node:test";

import type { StartupPlannerData } from "@/lib/services/startup-planner-service";

import { getStartupPlannerSectionState } from "./startup-planner-sections";

function createStartupData(overrides: Partial<StartupPlannerData> = {}): StartupPlannerData {
  return {
    week: {
      weekStart: "2026-04-20",
      weekEnd: "2026-04-26",
      previousWeekStart: "2026-04-13",
      previousWeekEnd: "2026-04-19",
    },
    review: {
      currentWeek: null,
      latest: null,
    },
    blockersCarryForward: [],
    keyGoals: [],
    focusTasks: [],
    dueSoonTasks: [],
    planThisWeekTasks: [],
    todaySummary: {
      plannedCount: 0,
      inProgressCount: 0,
      blockedCount: 0,
    },
    ...overrides,
  };
}

test("section state handles empty startup data safely", () => {
  const sectionState = getStartupPlannerSectionState(createStartupData());

  assert.deepEqual(sectionState, {
    blockersCount: 0,
    goalsCount: 0,
    focusCount: 0,
    dueSoonCount: 0,
    planThisWeekCount: 0,
    hasLatestReview: false,
  });
});

test("section state counts actionable weekly plan tasks and review availability", () => {
  const sectionState = getStartupPlannerSectionState(
    createStartupData({
      review: {
        currentWeek: null,
        latest: {
          id: "review-1",
          weekStart: "2026-04-13",
          weekEnd: "2026-04-19",
          summary: "Summary",
          wins: null,
          blockers: null,
          nextSteps: null,
          updatedAt: "2026-04-20T08:00:00.000Z",
        },
      },
      blockersCarryForward: [
        {
          id: "blocked-1",
          title: "Blocked",
          blockedReason: "Waiting on API key",
          status: "blocked",
          priority: "high",
          dueDate: null,
          plannedForDate: null,
          focusRank: null,
          updatedAt: "2026-04-20T08:00:00.000Z",
          projectName: "Ops",
          projectSlug: "ops",
          goalTitle: null,
          isPlannedForToday: false,
        },
      ],
      keyGoals: [
        {
          id: "goal-1",
          title: "Goal",
          status: "active",
          health: "on_track",
          nextStep: null,
          updatedAt: "2026-04-20T08:00:00.000Z",
          projectName: "Ops",
          projectSlug: "ops",
          linkedOpenTaskCount: 2,
        },
      ],
      planThisWeekTasks: [
        {
          id: "task-1",
          title: "Task",
          blockedReason: null,
          status: "todo",
          priority: "medium",
          dueDate: "2026-04-21",
          plannedForDate: null,
          focusRank: 1,
          updatedAt: "2026-04-20T08:00:00.000Z",
          projectName: "Ops",
          projectSlug: "ops",
          goalTitle: null,
          isPlannedForToday: false,
        },
        {
          id: "task-2",
          title: "Done Task",
          blockedReason: null,
          status: "done",
          priority: "medium",
          dueDate: null,
          plannedForDate: null,
          focusRank: null,
          updatedAt: "2026-04-20T08:00:00.000Z",
          projectName: "Ops",
          projectSlug: "ops",
          goalTitle: null,
          isPlannedForToday: false,
        },
      ],
    }),
  );

  assert.equal(sectionState.blockersCount, 1);
  assert.equal(sectionState.goalsCount, 1);
  assert.equal(sectionState.planThisWeekCount, 1);
  assert.equal(sectionState.hasLatestReview, true);
});
