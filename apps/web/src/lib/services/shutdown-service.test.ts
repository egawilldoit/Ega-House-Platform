import assert from "node:assert/strict";
import test from "node:test";

import {
  getShutdownData,
  queueTaskForTomorrow,
} from "./shutdown-service";

function createTodayPlannerResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    errorMessage: null,
    data: {
      date: "2026-04-21",
      planned: [],
      inProgress: [],
      blocked: [],
      completed: [],
      suggestions: {
        pinned: [],
        inProgress: [],
      },
      summary: {
        plannedCount: 0,
        inProgressCount: 0,
        blockedCount: 0,
        completedCount: 0,
        clearableCompletedCount: 0,
        totalEstimateMinutes: 0,
        trackedTodaySeconds: 0,
        trackedTodayLabel: "0m",
      },
      activeTimer: null,
      ...overrides,
    },
  };
}

function createShutdownDataSupabaseMock(options?: {
  dueSoonRows?: unknown[];
  reviewRow?: { id: string; summary: string | null; next_steps: string | null; updated_at: string } | null;
}) {
  const dueSoonRows = options?.dueSoonRows ?? [];
  const reviewRow = options?.reviewRow ?? null;

  return {
    from(table: string) {
      if (table === "tasks") {
        return {
          select() {
            const chain = {
              neq() {
                return chain;
              },
              gte() {
                return chain;
              },
              lte() {
                return chain;
              },
              is() {
                return chain;
              },
              order() {
                return chain;
              },
              limit() {
                return Promise.resolve({
                  data: dueSoonRows,
                  error: null,
                });
              },
            };

            return chain;
          },
        };
      }

      assert.equal(table, "week_reviews");
      return {
        select() {
          const chain = {
            eq() {
              return chain;
            },
            order() {
              return chain;
            },
            limit() {
              return chain;
            },
            maybeSingle() {
              return Promise.resolve({
                data: reviewRow,
                error: null,
              });
            },
          };

          return chain;
        },
      };
    },
  };
}

function createQueueTaskSupabaseMock(options?: {
  ownedTaskId?: string | null;
  onUpdate?: (payload: Record<string, unknown>, taskId: string) => void;
}) {
  return {
    from(table: string) {
      assert.equal(table, "tasks");
      return {
        select(columns: string) {
          assert.equal(columns, "id");
          return {
            eq(column: string, value: string) {
              assert.equal(column, "id");
              return {
                maybeSingle() {
                  if (options?.ownedTaskId && value === options.ownedTaskId) {
                    return Promise.resolve({ data: { id: value }, error: null });
                  }

                  return Promise.resolve({ data: null, error: null });
                },
              };
            },
          };
        },
        update(payload: Record<string, unknown>) {
          return {
            eq(column: string, value: string) {
              assert.equal(column, "id");
              options?.onUpdate?.(payload, value);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

test("shutdown data loads today summary, carry-forward, blockers, and shortlist", async () => {
  const todayResult = createTodayPlannerResult({
    planned: [
      {
        id: "task-planned",
        title: "Plan next sprint",
        description: null,
        blockedReason: null,
        status: "todo",
        priority: "medium",
        dueDate: "2026-04-21",
        estimateMinutes: null,
        focusRank: null,
        plannedForDate: "2026-04-21",
        updatedAt: "2026-04-21T10:00:00.000Z",
        projectName: "Ops",
        projectSlug: "ops",
        goalTitle: null,
        hasActiveTimer: false,
        isDueToday: true,
        isPlannedForToday: true,
      },
    ],
    blocked: [
      {
        id: "task-blocked",
        title: "Fix deploy issue",
        description: null,
        blockedReason: "Waiting for infra key",
        status: "blocked",
        priority: "high",
        dueDate: "2026-04-21",
        estimateMinutes: null,
        focusRank: null,
        plannedForDate: "2026-04-21",
        updatedAt: "2026-04-21T11:00:00.000Z",
        projectName: "Infra",
        projectSlug: "infra",
        goalTitle: "Stabilize deploy",
        hasActiveTimer: false,
        isDueToday: true,
        isPlannedForToday: true,
      },
    ],
    completed: [
      {
        id: "task-done",
        title: "Ship EOD card",
        description: null,
        blockedReason: null,
        status: "done",
        priority: "medium",
        dueDate: "2026-04-21",
        estimateMinutes: null,
        focusRank: null,
        plannedForDate: "2026-04-21",
        updatedAt: "2026-04-21T09:00:00.000Z",
        projectName: "Product",
        projectSlug: "product",
        goalTitle: null,
        hasActiveTimer: false,
        isDueToday: true,
        isPlannedForToday: true,
      },
    ],
    suggestions: {
      pinned: [
        {
          id: "task-pinned",
          title: "Draft tomorrow priorities",
          description: null,
          blockedReason: null,
          status: "todo",
          priority: "medium",
          dueDate: "2026-04-22",
          estimateMinutes: null,
          focusRank: 1,
          plannedForDate: null,
          updatedAt: "2026-04-21T10:30:00.000Z",
          projectName: "Planning",
          projectSlug: "planning",
          goalTitle: null,
          hasActiveTimer: false,
          isDueToday: false,
          isPlannedForToday: false,
        },
      ],
      inProgress: [],
    },
    summary: {
      plannedCount: 1,
      inProgressCount: 0,
      blockedCount: 1,
      completedCount: 1,
      clearableCompletedCount: 1,
      totalEstimateMinutes: 0,
      trackedTodaySeconds: 3600,
      trackedTodayLabel: "1h 0m",
    },
  });

  const supabase = createShutdownDataSupabaseMock({
    dueSoonRows: [
      {
        id: "task-due-soon",
        title: "Prepare standup",
        status: "todo",
        due_date: "2026-04-22",
        planned_for_date: null,
        blocked_reason: null,
        projects: { name: "Ops", slug: "ops" },
        goals: null,
      },
    ],
    reviewRow: {
      id: "review-1",
      summary: "Weekly reflection",
      next_steps: "Close carry-overs",
      updated_at: "2026-04-21T12:00:00.000Z",
    },
  });

  const result = await getShutdownData({
    supabase: supabase as never,
    now: new Date("2026-04-21T12:00:00.000Z"),
    todayPlannerResult: todayResult as never,
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.summary.completedCount, 1);
  assert.equal(result.data?.summary.unfinishedCount, 2);
  assert.equal(result.data?.summary.blockerCount, 1);
  assert.equal(result.data?.summary.trackedTodayLabel, "1h 0m");
  assert.equal(result.data?.tomorrowShortlist.length, 2);
  assert.equal(result.data?.currentWeekReview?.id, "review-1");
});

test("shutdown data handles empty states cleanly", async () => {
  const supabase = createShutdownDataSupabaseMock({
    dueSoonRows: [],
    reviewRow: null,
  });

  const result = await getShutdownData({
    supabase: supabase as never,
    now: new Date("2026-04-21T12:00:00.000Z"),
    todayPlannerResult: createTodayPlannerResult() as never,
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.completedWork.length, 0);
  assert.equal(result.data?.unfinishedCarryForward.length, 0);
  assert.equal(result.data?.blockers.length, 0);
  assert.equal(result.data?.tomorrowShortlist.length, 0);
  assert.equal(result.data?.currentWeekReview, null);
});

test("queueTaskForTomorrow updates only owned tasks", async () => {
  let updatedTaskId = "";
  let updatedPayload: Record<string, unknown> | null = null;
  const supabase = createQueueTaskSupabaseMock({
    ownedTaskId: "task-owned",
    onUpdate: (payload, taskId) => {
      updatedTaskId = taskId;
      updatedPayload = payload;
    },
  });

  const result = await queueTaskForTomorrow("task-owned", {
    supabase: supabase as never,
    now: new Date("2026-04-21T18:00:00.000Z"),
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.tomorrowDate, "2026-04-22");
  assert.equal(updatedTaskId, "task-owned");
  assert.equal(updatedPayload?.["planned_for_date"], "2026-04-22");
});

test("queueTaskForTomorrow blocks unavailable task ids", async () => {
  let updateCalled = false;
  const supabase = createQueueTaskSupabaseMock({
    ownedTaskId: "task-owned",
    onUpdate: () => {
      updateCalled = true;
    },
  });

  const result = await queueTaskForTomorrow("task-other", {
    supabase: supabase as never,
    now: new Date("2026-04-21T18:00:00.000Z"),
  });

  assert.equal(result.errorMessage, "Task is unavailable.");
  assert.equal(updateCalled, false);
});
