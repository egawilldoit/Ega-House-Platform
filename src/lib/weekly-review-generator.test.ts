import assert from "node:assert/strict";
import test from "node:test";

import {
  generateWeeklyReviewDraft,
  type WeeklyReviewDraftInput,
  type WeeklyReviewTaskActivity,
} from "./weekly-review-generator";

const baseInput: WeeklyReviewDraftInput = {
  weekStart: "2026-04-20",
  weekEnd: "2026-04-26",
  completedTasks: [],
  carriedTasks: [],
  blockedTasks: [],
  projectTime: [],
  taskTime: [],
  touchedProjects: [],
  touchedGoals: [],
  previousReview: null,
};

function task(overrides: Partial<WeeklyReviewTaskActivity>): WeeklyReviewTaskActivity {
  return {
    id: "task-1",
    title: "Write launch plan",
    status: "todo",
    blockedReason: null,
    estimateMinutes: null,
    completedAt: null,
    updatedAt: "2026-04-22T10:00:00.000Z",
    projectName: "EGA House",
    goalTitle: null,
    trackedSeconds: 0,
    ...overrides,
  };
}

test("generates helpful no-activity draft", () => {
  const draft = generateWeeklyReviewDraft(baseInput);

  assert.match(draft.summary, /no completed tasks, blockers, carried tasks, or tracked time/);
  assert.match(draft.summary, /No previous weekly review/);
  assert.match(draft.wins, /No tasks were completed/);
  assert.match(draft.nextSteps, /Pick one priority task/);
});

test("includes completed tasks as wins and completed task section", () => {
  const draft = generateWeeklyReviewDraft({
    ...baseInput,
    completedTasks: [
      task({
        id: "done-1",
        title: "Ship timer handoff",
        status: "done",
        completedAt: "2026-04-23T12:00:00.000Z",
        estimateMinutes: 90,
        trackedSeconds: 7200,
        goalTitle: "Improve execution loop",
      }),
    ],
    touchedProjects: ["EGA House"],
    touchedGoals: ["Improve execution loop"],
  });

  assert.match(draft.summary, /1 task completed/);
  assert.match(draft.summary, /Touched goals: Improve execution loop/);
  assert.match(draft.wins, /Completed Tasks/);
  assert.match(draft.wins, /Ship timer handoff \(EGA House \/ Improve execution loop; estimate 1h 30m, tracked 2h 0m 0s\)/);
});

test("includes blocked task reasons in blocker draft", () => {
  const draft = generateWeeklyReviewDraft({
    ...baseInput,
    blockedTasks: [
      task({
        id: "blocked-1",
        title: "Publish analytics view",
        status: "blocked",
        blockedReason: "Waiting on event naming decision",
      }),
    ],
  });

  assert.match(draft.summary, /1 blocker active/);
  assert.match(draft.blockers, /Publish analytics view/);
  assert.match(draft.blockers, /Waiting on event naming decision/);
  assert.match(draft.nextSteps, /Unblock: Publish analytics view/);
});

test("summarizes timer-heavy weeks by project and task", () => {
  const draft = generateWeeklyReviewDraft({
    ...baseInput,
    projectTime: [
      { id: "project-1", label: "EGA House", trackedSeconds: 14_400, sessionCount: 3 },
      { id: "project-2", label: "Ops", trackedSeconds: 3_600, sessionCount: 1 },
    ],
    taskTime: [
      { id: "task-1", label: "Deep implementation", trackedSeconds: 10_800, sessionCount: 2 },
    ],
  });

  assert.match(draft.summary, /5h 0m 0s tracked/);
  assert.match(draft.summary, /EGA House: 4h 0m 0s across 3 sessions/);
  assert.match(draft.summary, /Deep implementation: 3h 0m 0s across 2 sessions/);
});

test("keeps previous saved review as context without replacing it", () => {
  const draft = generateWeeklyReviewDraft({
    ...baseInput,
    previousReview: {
      weekStart: "2026-04-13",
      weekEnd: "2026-04-19",
      summary: "Last week focused on cleanup.",
      nextSteps: "Start review generation.",
    },
  });

  assert.match(draft.summary, /Previous review \(2026-04-13 to 2026-04-19\) context/);
  assert.match(draft.summary, /Start review generation/);
});

test("handles missing optional goals and estimates", () => {
  const draft = generateWeeklyReviewDraft({
    ...baseInput,
    completedTasks: [
      task({
        title: "Close inbox task",
        projectName: "Ops",
        goalTitle: null,
        estimateMinutes: null,
        trackedSeconds: 0,
      }),
    ],
  });

  assert.match(draft.wins, /Close inbox task \(Ops\)/);
  assert.doesNotMatch(draft.wins, /estimate/);
});
