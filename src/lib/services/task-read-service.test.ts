import assert from "node:assert/strict";
import test from "node:test";

import { getActiveTasksForOwner, getTaskForOwner } from "./task-read-service";

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
          };
          const missingSelectedColumn = [...missingColumns].find((column) =>
            columns.includes(column),
          );

          return {
            eq(column: string, value: string) {
              assert.equal(column, "id");
              state.taskId = value;
              return this;
            },
            is(column: string, value: null) {
              assert.equal(column, "archived_at");
              assert.equal(value, null);
              state.onlyActive = true;
              return this;
            },
            order(column: string) {
              assert.equal(column, "updated_at");

              if (missingSelectedColumn) {
                return Promise.resolve({
                  data: null,
                  error: createMissingColumnError(missingSelectedColumn),
                });
              }

              const data = tasks.filter((task) =>
                state.onlyActive ? (task.archived_at ?? null) === null : true,
              );
              return Promise.resolve({ data, error: null });
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
        },
      };
    },
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
