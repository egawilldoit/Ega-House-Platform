import assert from "node:assert/strict";
import test from "node:test";

import { clearCompletedFromToday, getTodayPlannerData } from "./today-planner-service";

type QueryResult = {
  data: unknown[] | null;
  error: { message: string } | null;
};

function createTaskRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "task-1",
    title: "Task",
    description: null,
    status: "todo",
    priority: "medium",
    due_date: null,
    estimate_minutes: null,
    focus_rank: null,
    planned_for_date: null,
    updated_at: "2026-04-20T10:00:00.000Z",
    projects: { name: "Project", slug: "project" },
    goals: null,
    ...overrides,
  };
}

function createSupabaseMock(queryResults: QueryResult[], onOrClause?: (value: string) => void) {
  let index = 0;

  return {
    from(table: string) {
      assert.equal(table, "tasks");

      return {
        select() {
          const chain = {
            eq() {
              return chain;
            },
            neq() {
              return chain;
            },
            not() {
              return chain;
            },
            or(value: string) {
              onOrClause?.(value);
              return chain;
            },
            order() {
              return chain;
            },
            limit() {
              const result = queryResults[index];
              index += 1;
              assert.ok(result, "Unexpected query invocation.");
              return Promise.resolve(result);
            },
          };

          return chain;
        },
      };
    },
  };
}

function createTimerOverrides() {
  return {
    activeTimerResult: {
      data: null,
      errorMessage: null,
    },
    timerSummaryResult: {
      data: {
        trackedTodaySeconds: 0,
        trackedTodayLabel: "0m",
        trackedTotalSeconds: 0,
        trackedTotalLabel: "0m",
        sessionsTodayCount: 0,
        longestSessionSeconds: null,
        longestSessionLabel: null,
        longestSessionTaskTitle: null,
      },
      errorMessage: null,
    },
  };
}

function createSupabaseUpdateMock(onUpdateCall?: (payload: Record<string, unknown>, filters: Record<string, unknown>) => void) {
  const filters: Record<string, unknown> = {};

  return {
    from(table: string) {
      assert.equal(table, "tasks");

      return {
        update(payload: Record<string, unknown>) {
          return {
            eq(column: string, value: unknown) {
              filters[column] = value;

              return {
                eq(secondColumn: string, secondValue: unknown) {
                  filters[secondColumn] = secondValue;
                  onUpdateCall?.(payload, filters);
                  return Promise.resolve({ error: null });
                },
              };
            },
          };
        },
      };
    },
  };
}

test("includes due-today tasks in Today when they are not manually planned", async () => {
  const supabase = createSupabaseMock([
    {
      data: [
        createTaskRow({
          id: "due-today-only",
          due_date: "2026-04-20",
          planned_for_date: null,
          status: "todo",
        }),
      ],
      error: null,
    },
    { data: [], error: null },
    { data: [], error: null },
  ]);

  const result = await getTodayPlannerData({
    supabase: supabase as never,
    now: new Date("2026-04-20T12:00:00.000Z"),
    ...createTimerOverrides(),
  });

  assert.equal(result.errorMessage, null);
  assert.deepEqual(result.data?.planned.map((task) => task.id), ["due-today-only"]);
});

test("includes manually planned tasks with no due date in Today", async () => {
  const supabase = createSupabaseMock([
    {
      data: [
        createTaskRow({
          id: "planned-only",
          planned_for_date: "2026-04-20",
          due_date: null,
          status: "todo",
        }),
      ],
      error: null,
    },
    { data: [], error: null },
    { data: [], error: null },
  ]);

  const result = await getTodayPlannerData({
    supabase: supabase as never,
    now: new Date("2026-04-20T12:00:00.000Z"),
    ...createTimerOverrides(),
  });

  assert.equal(result.errorMessage, null);
  assert.deepEqual(result.data?.planned.map((task) => task.id), ["planned-only"]);
});

test("deduplicates tasks that match both planned_for_date and due_date for today", async () => {
  const bothRow = createTaskRow({
    id: "both",
    planned_for_date: "2026-04-20",
    due_date: "2026-04-20",
    status: "in_progress",
  });

  const supabase = createSupabaseMock([
    {
      data: [bothRow, bothRow],
      error: null,
    },
    { data: [], error: null },
    { data: [], error: null },
  ]);

  const result = await getTodayPlannerData({
    supabase: supabase as never,
    now: new Date("2026-04-20T12:00:00.000Z"),
    ...createTimerOverrides(),
  });

  assert.equal(result.errorMessage, null);
  assert.deepEqual(result.data?.inProgress.map((task) => task.id), ["both"]);
});

test("keeps non-matching tasks out of the Today main set", async () => {
  const supabase = createSupabaseMock([
    { data: [], error: null },
    {
      data: [
        createTaskRow({
          id: "pinned-future",
          due_date: "2026-04-21",
          planned_for_date: null,
          focus_rank: 1,
        }),
      ],
      error: null,
    },
    { data: [], error: null },
  ]);

  const result = await getTodayPlannerData({
    supabase: supabase as never,
    now: new Date("2026-04-20T12:00:00.000Z"),
    ...createTimerOverrides(),
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.planned.length, 0);
  assert.equal(result.data?.inProgress.length, 0);
  assert.equal(result.data?.blocked.length, 0);
  assert.equal(result.data?.completed.length, 0);
});

test("uses planned-or-due selection and excludes Today-visible tasks from suggestions", async () => {
  const orClauses: string[] = [];
  const supabase = createSupabaseMock(
    [
      {
        data: [
          createTaskRow({
            id: "due-today-main",
            due_date: "2026-04-20",
            planned_for_date: null,
            status: "todo",
          }),
          createTaskRow({
            id: "planned-main",
            due_date: null,
            planned_for_date: "2026-04-20",
            status: "done",
          }),
        ],
        error: null,
      },
      {
        data: [
          createTaskRow({
            id: "due-today-main",
            due_date: "2026-04-20",
            focus_rank: 1,
          }),
          createTaskRow({
            id: "pinned-extra",
            due_date: "2026-04-23",
            planned_for_date: null,
            focus_rank: 2,
          }),
        ],
        error: null,
      },
      {
        data: [
          createTaskRow({
            id: "due-today-main",
            status: "in_progress",
          }),
          createTaskRow({
            id: "in-progress-extra",
            status: "in_progress",
            due_date: "2026-04-23",
            planned_for_date: null,
          }),
        ],
        error: null,
      },
    ],
    (value) => {
      orClauses.push(value);
    },
  );

  const result = await getTodayPlannerData({
    supabase: supabase as never,
    now: new Date("2026-04-20T12:00:00.000Z"),
    ...createTimerOverrides(),
  });

  assert.equal(result.errorMessage, null);
  assert.equal(orClauses.length, 1);
  assert.match(orClauses[0], /planned_for_date\.eq\.2026-04-20/);
  assert.match(orClauses[0], /due_date\.eq\.2026-04-20/);

  assert.deepEqual(result.data?.suggestions.pinned.map((task) => task.id), ["pinned-extra"]);
  assert.deepEqual(result.data?.suggestions.inProgress.map((task) => task.id), ["in-progress-extra"]);
  assert.equal("dueToday" in (result.data?.suggestions ?? {}), false);
});

test("reports clearable completed count for tasks manually planned for today", async () => {
  const supabase = createSupabaseMock([
    {
      data: [
        createTaskRow({
          id: "completed-planned",
          status: "done",
          planned_for_date: "2026-04-20",
          due_date: null,
        }),
        createTaskRow({
          id: "completed-due-and-planned",
          status: "done",
          planned_for_date: "2026-04-20",
          due_date: "2026-04-20",
        }),
        createTaskRow({
          id: "completed-due-only",
          status: "done",
          planned_for_date: null,
          due_date: "2026-04-20",
        }),
      ],
      error: null,
    },
    { data: [], error: null },
    { data: [], error: null },
  ]);

  const result = await getTodayPlannerData({
    supabase: supabase as never,
    now: new Date("2026-04-20T12:00:00.000Z"),
    ...createTimerOverrides(),
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.summary.completedCount, 3);
  assert.equal(result.data?.summary.clearableCompletedCount, 2);
});

test("does not count incomplete planned-today tasks as clearable completed", async () => {
  const supabase = createSupabaseMock([
    {
      data: [
        createTaskRow({
          id: "incomplete-planned",
          status: "todo",
          planned_for_date: "2026-04-20",
          due_date: null,
        }),
      ],
      error: null,
    },
    { data: [], error: null },
    { data: [], error: null },
  ]);

  const result = await getTodayPlannerData({
    supabase: supabase as never,
    now: new Date("2026-04-20T12:00:00.000Z"),
    ...createTimerOverrides(),
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.summary.completedCount, 0);
  assert.equal(result.data?.summary.clearableCompletedCount, 0);
  assert.deepEqual(result.data?.planned.map((task) => task.id), ["incomplete-planned"]);
});

test("reports no clearable completed tasks when completed items are due-today-only", async () => {
  const supabase = createSupabaseMock([
    {
      data: [
        createTaskRow({
          id: "completed-due-only",
          status: "done",
          planned_for_date: null,
          due_date: "2026-04-20",
        }),
      ],
      error: null,
    },
    { data: [], error: null },
    { data: [], error: null },
  ]);

  const result = await getTodayPlannerData({
    supabase: supabase as never,
    now: new Date("2026-04-20T12:00:00.000Z"),
    ...createTimerOverrides(),
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.summary.completedCount, 1);
  assert.equal(result.data?.summary.clearableCompletedCount, 0);
});

test("clearCompletedFromToday only clears completed tasks manually planned for today", async () => {
  let capturedPayload: Record<string, unknown> | null = null;
  let capturedFilters: Record<string, unknown> | null = null;

  const supabase = createSupabaseUpdateMock((payload, filters) => {
    capturedPayload = payload;
    capturedFilters = { ...filters };
  });

  const result = await clearCompletedFromToday({
    supabase: supabase as never,
    now: new Date("2026-04-20T12:00:00.000Z"),
  });

  assert.equal(result.errorMessage, null);
  assert.ok(capturedPayload);
  assert.deepEqual(capturedPayload, {
    planned_for_date: null,
    updated_at: capturedPayload["updated_at"],
  });
  assert.equal(typeof capturedPayload["updated_at"], "string");
  assert.deepEqual(capturedFilters, {
    status: "done",
    planned_for_date: "2026-04-20",
  });
});
