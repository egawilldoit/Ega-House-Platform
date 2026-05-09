import assert from "node:assert/strict";
import test from "node:test";

import {
  getActiveTasksForOwner,
  getFocusQueueTaskRows,
  getStartupBlockedTasks,
  getStartupDueSoonTasks,
  getStartupFocusCandidates,
  getTaskForOwner,
  getTodayPinnedSuggestionRows,
  getTodaySelectedTaskRows,
} from "./task-read-service";

type MockTask = {
  id: string;
  title: string;
  description: string | null;
  blocked_reason?: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  estimate_minutes: number | null;
  updated_at: string;
  completed_at?: string | null;
  project_id: string;
  goal_id: string | null;
  focus_rank: number | null;
  planned_for_date: string | null;
  archived_at?: string | null;
  archived_by?: string | null;
  projects: { name: string; slug?: string | null } | null;
  goals: { title: string } | null;
};

function createMissingColumnError(column: string) {
  return {
    code: "PGRST204",
    message: `Could not find the '${column}' column of 'public.tasks' in the schema cache`,
  };
}

function createTaskReadSupabaseMock(
  tasks: MockTask[],
  options?: { missingColumns?: string[] },
) {
  const missingColumns = new Set(options?.missingColumns ?? []);

  return {
    from(table: string) {
      assert.equal(table, "tasks");

      return {
        select(columns: string) {
          const state = {
            taskId: null as string | null,
            onlyActive: false,
            filters: [] as Array<(task: MockTask) => boolean>,
            orders: [] as Array<{ column: keyof MockTask; ascending: boolean }>,
            limit: null as number | null,
          };
          const missingSelectedColumn = [...missingColumns].find((column) =>
            columns.includes(column),
          );
          const execute = async () => {
            if (missingSelectedColumn) {
              return {
                data: null,
                error: createMissingColumnError(missingSelectedColumn),
              };
            }

            let data = tasks.filter((task) =>
              state.onlyActive ? (task.archived_at ?? null) === null : true,
            );
            for (const filter of state.filters) {
              data = data.filter(filter);
            }
            data = [...data].sort((left, right) => {
              for (const order of state.orders) {
                const leftValue = left[order.column];
                const rightValue = right[order.column];
                if (leftValue === rightValue) {
                  continue;
                }
                if (leftValue === null || leftValue === undefined) {
                  return 1;
                }
                if (rightValue === null || rightValue === undefined) {
                  return -1;
                }
                const direction = order.ascending ? 1 : -1;
                return leftValue > rightValue ? direction : -direction;
              }
              return 0;
            });

            if (state.limit !== null) {
              data = data.slice(0, state.limit);
            }

            return { data, error: null };
          };

          const query = {
            eq(column: keyof MockTask, value: string) {
              if (column === "id") {
                state.taskId = value;
              }
              state.filters.push((task) => task[column] === value);
              return this;
            },
            neq(column: keyof MockTask, value: string) {
              state.filters.push((task) => task[column] !== value);
              return this;
            },
            gte(column: keyof MockTask, value: string) {
              state.filters.push((task) => {
                const columnValue = task[column];
                return typeof columnValue === "string" && columnValue >= value;
              });
              return this;
            },
            lte(column: keyof MockTask, value: string) {
              state.filters.push((task) => {
                const columnValue = task[column];
                return typeof columnValue === "string" && columnValue <= value;
              });
              return this;
            },
            is(column: string, value: null) {
              assert.equal(column, "archived_at");
              assert.equal(value, null);
              state.onlyActive = true;
              return this;
            },
            not(column: keyof MockTask, operator: string, value: null) {
              assert.equal(operator, "is");
              assert.equal(value, null);
              state.filters.push((task) => task[column] !== null && task[column] !== undefined);
              return this;
            },
            or(filters: string) {
              const clauses = filters.split(",").map((filter) => {
                const [column, operator, value] = filter.split(".");
                assert.equal(operator, "eq");
                return { column: column as keyof MockTask, value };
              });
              state.filters.push((task) =>
                clauses.some((clause) => task[clause.column] === clause.value),
              );
              return this;
            },
            order(column: keyof MockTask, options?: { ascending?: boolean }) {
              state.orders.push({ column, ascending: options?.ascending ?? true });
              return this;
            },
            limit(count: number) {
              state.limit = count;
              return this;
            },
            maybeSingle: async () => {
              if (missingSelectedColumn) {
                return {
                  data: null,
                  error: createMissingColumnError(missingSelectedColumn),
                };
              }

              const task = tasks.find((row) => row.id === state.taskId) ?? null;
              return { data: task, error: null };
            },
          };

          return attachThenable(query, execute);
        },
      };
    },
  };
}

function attachThenable<T extends object, TResult>(
  query: T,
  execute: () => Promise<TResult>,
): T & PromiseLike<TResult> {
  Object.defineProperty(query, "then", {
    value: <TResult1 = TResult, TResult2 = never>(
      onfulfilled?: ((value: TResult) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => execute().then(onfulfilled, onrejected),
    enumerable: false,
  });
  return query as T & PromiseLike<TResult>;
}

function createMockTask(overrides: Partial<MockTask> & Pick<MockTask, "id" | "title">): MockTask {
  const { id, title, ...rest } = overrides;

  return {
    id,
    title,
    description: null,
    blocked_reason: null,
    status: "todo",
    priority: "medium",
    due_date: null,
    estimate_minutes: null,
    updated_at: "2026-04-29T10:00:00.000Z",
    completed_at: null,
    project_id: "project-1",
    goal_id: null,
    focus_rank: null,
    planned_for_date: null,
    archived_at: null,
    archived_by: null,
    projects: { name: "EGA House", slug: "ega-house" },
    goals: null,
    ...rest,
  };
}

test("getTaskForOwner returns a normalized task row when modern task columns exist", async () => {
  const supabase = createTaskReadSupabaseMock([
    {
      id: "task-1",
      title: "Plan launch",
      description: "Draft checklist",
      blocked_reason: "Waiting on review",
      status: "blocked",
      priority: "high",
      due_date: "2026-05-01",
      estimate_minutes: 45,
      updated_at: "2026-04-29T10:00:00.000Z",
      completed_at: "2026-04-29T09:00:00.000Z",
      project_id: "project-1",
      goal_id: "goal-1",
      focus_rank: 2,
      planned_for_date: "2026-04-29",
      archived_at: "2026-04-29T11:00:00.000Z",
      archived_by: "user-1",
      projects: { name: "EGA House", slug: "ega-house" },
      goals: { title: "Launch" },
    },
  ]);

  const result = await getTaskForOwner("task-1", {
    supabase: supabase as unknown as never,
  });

  assert.equal(result.errorMessage, null);
  assert.deepEqual(result.data, {
    id: "task-1",
    title: "Plan launch",
    description: "Draft checklist",
    blocked_reason: "Waiting on review",
    status: "blocked",
    priority: "high",
    due_date: "2026-05-01",
    estimate_minutes: 45,
    updated_at: "2026-04-29T10:00:00.000Z",
    completed_at: "2026-04-29T09:00:00.000Z",
    project_id: "project-1",
    goal_id: "goal-1",
    focus_rank: 2,
    planned_for_date: "2026-04-29",
    archived_at: "2026-04-29T11:00:00.000Z",
    archived_by: "user-1",
    projects: { name: "EGA House", slug: "ega-house" },
    goals: { title: "Launch" },
  });
});

test("getTaskForOwner falls back when blocked reason is unavailable", async () => {
  const supabase = createTaskReadSupabaseMock(
    [
      {
        id: "task-1",
        title: "Plan launch",
        description: null,
        status: "todo",
        priority: "medium",
        due_date: null,
        estimate_minutes: null,
        updated_at: "2026-04-29T10:00:00.000Z",
        completed_at: null,
        project_id: "project-1",
        goal_id: null,
        focus_rank: null,
        planned_for_date: null,
        archived_at: null,
        archived_by: null,
        projects: null,
        goals: null,
      },
    ],
    { missingColumns: ["blocked_reason"] },
  );

  const result = await getTaskForOwner("task-1", {
    supabase: supabase as unknown as never,
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.id, "task-1");
  assert.equal(result.data?.blocked_reason, null);
  assert.equal(result.data?.completed_at, null);
  assert.equal(result.data?.archived_at, null);
  assert.equal(result.data?.archived_by, null);
});

test("getActiveTasksForOwner excludes archived tasks by default", async () => {
  const supabase = createTaskReadSupabaseMock([
    {
      id: "active-task",
      title: "Active",
      description: null,
      blocked_reason: null,
      status: "todo",
      priority: "medium",
      due_date: null,
      estimate_minutes: null,
      updated_at: "2026-04-29T10:00:00.000Z",
      completed_at: null,
      project_id: "project-1",
      goal_id: null,
      focus_rank: null,
      planned_for_date: null,
      archived_at: null,
      archived_by: null,
      projects: null,
      goals: null,
    },
    {
      id: "archived-task",
      title: "Archived",
      description: null,
      blocked_reason: null,
      status: "todo",
      priority: "medium",
      due_date: null,
      estimate_minutes: null,
      updated_at: "2026-04-29T09:00:00.000Z",
      completed_at: null,
      project_id: "project-1",
      goal_id: null,
      focus_rank: null,
      planned_for_date: null,
      archived_at: "2026-04-29T11:00:00.000Z",
      archived_by: "user-1",
      projects: null,
      goals: null,
    },
  ]);

  const result = await getActiveTasksForOwner({
    supabase: supabase as unknown as never,
  });

  assert.equal(result.errorMessage, null);
  assert.deepEqual(result.data.map((task) => task.id), ["active-task"]);
});

test("getActiveTasksForOwner includes archived tasks when requested", async () => {
  const supabase = createTaskReadSupabaseMock([
    {
      id: "active-task",
      title: "Active",
      description: null,
      blocked_reason: null,
      status: "todo",
      priority: "medium",
      due_date: null,
      estimate_minutes: null,
      updated_at: "2026-04-29T10:00:00.000Z",
      completed_at: null,
      project_id: "project-1",
      goal_id: null,
      focus_rank: null,
      planned_for_date: null,
      archived_at: null,
      archived_by: null,
      projects: null,
      goals: null,
    },
    {
      id: "archived-task",
      title: "Archived",
      description: null,
      blocked_reason: null,
      status: "todo",
      priority: "medium",
      due_date: null,
      estimate_minutes: null,
      updated_at: "2026-04-29T09:00:00.000Z",
      completed_at: null,
      project_id: "project-1",
      goal_id: null,
      focus_rank: null,
      planned_for_date: null,
      archived_at: "2026-04-29T11:00:00.000Z",
      archived_by: "user-1",
      projects: null,
      goals: null,
    },
  ]);

  const result = await getActiveTasksForOwner({
    supabase: supabase as unknown as never,
    includeArchived: true,
  });

  assert.equal(result.errorMessage, null);
  assert.deepEqual(result.data.map((task) => task.id), ["active-task", "archived-task"]);
});

test("getActiveTasksForOwner falls back when archive columns are unavailable", async () => {
  const supabase = createTaskReadSupabaseMock(
    [
      {
        id: "task-1",
        title: "Active",
        description: null,
        blocked_reason: null,
        status: "todo",
        priority: "medium",
        due_date: null,
        estimate_minutes: null,
        updated_at: "2026-04-29T10:00:00.000Z",
        completed_at: null,
        project_id: "project-1",
        goal_id: null,
        focus_rank: null,
        planned_for_date: null,
        projects: null,
        goals: null,
      },
    ],
    { missingColumns: ["archived_at", "archived_by"] },
  );

  const result = await getActiveTasksForOwner({
    supabase: supabase as unknown as never,
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data[0]?.id, "task-1");
  assert.equal(result.data[0]?.archived_at, null);
  assert.equal(result.data[0]?.archived_by, null);
});

test("today selected read intent returns active tasks planned or due today", async () => {
  const supabase = createTaskReadSupabaseMock([
    createMockTask({
      id: "planned",
      title: "Planned",
      planned_for_date: "2026-05-07",
      updated_at: "2026-05-07T11:00:00.000Z",
    }),
    createMockTask({
      id: "due",
      title: "Due",
      due_date: "2026-05-07",
      updated_at: "2026-05-07T10:00:00.000Z",
    }),
    createMockTask({
      id: "archived-planned",
      title: "Archived planned",
      planned_for_date: "2026-05-07",
      archived_at: "2026-05-07T12:00:00.000Z",
    }),
    createMockTask({
      id: "later",
      title: "Later",
      due_date: "2026-05-08",
    }),
  ]);

  const result = await getTodaySelectedTaskRows({
    supabase: supabase as unknown as never,
    today: "2026-05-07",
  });

  assert.equal(result.errorMessage, null);
  assert.deepEqual(result.data.map((task) => task.id), ["planned", "due"]);
});

test("startup and focus queue read intents apply their task-specific filters", async () => {
  const supabase = createTaskReadSupabaseMock([
    createMockTask({
      id: "blocked",
      title: "Blocked",
      status: "blocked",
      updated_at: "2026-05-07T09:00:00.000Z",
    }),
    createMockTask({
      id: "focus-1",
      title: "Focus 1",
      focus_rank: 1,
      updated_at: "2026-05-07T08:00:00.000Z",
    }),
    createMockTask({
      id: "focus-2",
      title: "Focus 2",
      focus_rank: 2,
      status: "done",
      updated_at: "2026-05-07T10:00:00.000Z",
    }),
    createMockTask({
      id: "due-soon",
      title: "Due soon",
      due_date: "2026-05-08",
      updated_at: "2026-05-07T07:00:00.000Z",
    }),
  ]);

  const [blocked, startupFocus, focusQueue, dueSoon, pinned] = await Promise.all([
    getStartupBlockedTasks({ supabase: supabase as unknown as never }),
    getStartupFocusCandidates({ supabase: supabase as unknown as never }),
    getFocusQueueTaskRows({ supabase: supabase as unknown as never }),
    getStartupDueSoonTasks({
      supabase: supabase as unknown as never,
      today: "2026-05-07",
      dueSoonEndDate: "2026-05-09",
    }),
    getTodayPinnedSuggestionRows({ supabase: supabase as unknown as never }),
  ]);

  assert.deepEqual(blocked.data.map((task) => task.id), ["blocked"]);
  assert.deepEqual(startupFocus.data.map((task) => task.id), ["focus-1"]);
  assert.deepEqual(focusQueue.data.map((task) => task.id), ["focus-1", "focus-2"]);
  assert.deepEqual(dueSoon.data.map((task) => task.id), ["due-soon"]);
  assert.deepEqual(pinned.data.map((task) => task.id), ["focus-1"]);
});
