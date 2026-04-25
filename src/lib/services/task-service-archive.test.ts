import assert from "node:assert/strict";
import test from "node:test";

import { archiveTask, deleteTaskSafely, getTasksWorkspaceData, unarchiveTask } from "./task-service";

type TaskRow = {
  id: string;
  title: string;
  status: string;
  archived_at: string | null;
  archived_by: string | null;
  updated_at: string;
  focus_rank: number | null;
};

type SessionRow = {
  id: string;
  task_id: string;
  ended_at: string | null;
};

function createQueryMock(table: string, state: MockState) {
  const filters: Array<{ column: string; operator: "eq" | "is" | "not_is" | "in"; value: unknown }> = [];
  let mutation: Record<string, unknown> | null = null;
  let selectedColumns = "";

  const query = {
    select(columns: string) {
      selectedColumns = columns;
      state.selects.push({ table, columns });
      return query;
    },
    update(payload: Record<string, unknown>) {
      mutation = payload;
      state.updates.push({ table, payload });
      return query;
    },
    delete() {
      state.deletes.push(table);
      return query;
    },
    insert(payload: unknown) {
      state.inserts.push({ table, payload });
      return query;
    },
    eq(column: string, value: unknown) {
      filters.push({ column, operator: "eq", value });
      return query;
    },
    is(column: string, value: unknown) {
      filters.push({ column, operator: "is", value });
      return query;
    },
    not(column: string, operator: string, value: unknown) {
      if (operator === "is") {
        filters.push({ column, operator: "not_is", value });
      }
      return query;
    },
    in(column: string, values: unknown[]) {
      filters.push({ column, operator: "in", value: values });
      return query;
    },
    order() {
      return query;
    },
    limit() {
      return query;
    },
    maybeSingle() {
      const rows = executeRows(table, state, filters, mutation, selectedColumns);
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    },
    then(resolve: (value: { data: unknown[]; error: null; count?: number }) => void) {
      resolve({ data: executeRows(table, state, filters, mutation, selectedColumns), error: null });
    },
  };

  return query;
}

type MockState = {
  tasks: TaskRow[];
  sessions: SessionRow[];
  selects: Array<{ table: string; columns: string }>;
  updates: Array<{ table: string; payload: Record<string, unknown> }>;
  deletes: string[];
  inserts: Array<{ table: string; payload: unknown }>;
};

function applyFilters<T extends Record<string, unknown>>(
  rows: T[],
  filters: Array<{ column: string; operator: "eq" | "is" | "not_is" | "in"; value: unknown }>,
) {
  return rows.filter((row) =>
    filters.every((filter) => {
      if (filter.operator === "eq") {
        return row[filter.column] === filter.value;
      }

      if (filter.operator === "in") {
        return Array.isArray(filter.value) && filter.value.includes(row[filter.column]);
      }

      if (filter.operator === "is") {
        return row[filter.column] === filter.value;
      }

      return row[filter.column] !== filter.value;
    }),
  );
}

function executeRows(
  table: string,
  state: MockState,
  filters: Array<{ column: string; operator: "eq" | "is" | "not_is" | "in"; value: unknown }>,
  mutation: Record<string, unknown> | null,
  selectedColumns: string,
) {
  if (table === "tasks") {
    const rows = applyFilters(state.tasks as unknown as Array<Record<string, unknown>>, filters);
    if (mutation) {
      for (const row of rows) {
        Object.assign(row, mutation);
      }
    }
    return rows.map((row) => ({
      ...row,
      description: null,
      blocked_reason: row.status === "blocked" ? "Waiting on review" : null,
      priority: "medium",
      due_date: null,
      estimate_minutes: null,
      project_id: "project-1",
      goal_id: null,
      projects: { name: "Project" },
      goals: null,
    }));
  }

  if (table === "task_sessions") {
    return applyFilters(state.sessions as unknown as Array<Record<string, unknown>>, filters);
  }

  if (table === "projects") {
    return [{ id: "project-1", name: "Project" }];
  }

  if (table === "goals" || table === "task_saved_views") {
    return [];
  }

  return selectedColumns ? [] : [];
}

function createMockSupabase(tasks: TaskRow[], sessions: SessionRow[] = []) {
  const state: MockState = {
    tasks,
    sessions,
    selects: [],
    updates: [],
    deletes: [],
    inserts: [],
  };

  return {
    state,
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      },
      from: (table: string) => createQueryMock(table, state),
    },
  };
}

function task(id: string, status: string, archivedAt: string | null = null): TaskRow {
  return {
    id,
    title: `Task ${id}`,
    status,
    archived_at: archivedAt,
    archived_by: null,
    updated_at: "2026-04-24T12:00:00.000Z",
    focus_rank: 1,
  };
}

for (const status of ["todo", "in_progress", "blocked", "done"]) {
  test(`archives ${status} tasks without deleting rows`, async () => {
    const { supabase, state } = createMockSupabase([task("task-1", status)]);

    const result = await archiveTask("task-1", {
      supabase: supabase as never,
      updatedAtIso: "2026-04-25T12:00:00.000Z",
    });

    assert.equal(result.errorMessage, null);
    assert.equal(state.tasks.length, 1);
    assert.equal(state.tasks[0].archived_at, "2026-04-25T12:00:00.000Z");
    assert.equal(state.tasks[0].archived_by, "user-1");
    assert.equal(state.deletes.length, 0);
  });
}

test("unarchive clears archive metadata", async () => {
  const { supabase, state } = createMockSupabase([
    { ...task("task-1", "done", "2026-04-25T12:00:00.000Z"), archived_by: "user-1" },
  ]);

  const result = await unarchiveTask("task-1", {
    supabase: supabase as never,
    updatedAtIso: "2026-04-25T13:00:00.000Z",
  });

  assert.equal(result.errorMessage, null);
  assert.equal(state.tasks[0].archived_at, null);
  assert.equal(state.tasks[0].archived_by, null);
});

test("task workspace archive views filter active archived and all tasks", async () => {
  const tasks = [
    task("active-task", "todo"),
    task("archived-task", "done", "2026-04-25T12:00:00.000Z"),
  ];
  const { supabase } = createMockSupabase(tasks);
  const baseFilters = {
    activeStatus: null,
    requestedProjectId: null,
    requestedGoalId: null,
    activeDueFilter: "all" as const,
    activeSort: "updated_desc" as const,
  };

  const active = await getTasksWorkspaceData({ ...baseFilters, activeView: "active" }, { supabase: supabase as never });
  const archived = await getTasksWorkspaceData({ ...baseFilters, activeView: "archived" }, { supabase: supabase as never });
  const all = await getTasksWorkspaceData({ ...baseFilters, activeView: "all" }, { supabase: supabase as never });

  assert.deepEqual(active.tasks.map((row) => row.id), ["active-task"]);
  assert.deepEqual(archived.tasks.map((row) => row.id), ["archived-task"]);
  assert.deepEqual(all.tasks.map((row) => row.id).sort(), ["active-task", "archived-task"]);
});

test("archive blocks active timer but delete protection still uses delete-safe path", async () => {
  const { supabase, state } = createMockSupabase(
    [task("task-1", "in_progress")],
    [{ id: "session-1", task_id: "task-1", ended_at: null }],
  );

  const archiveResult = await archiveTask("task-1", { supabase: supabase as never });
  assert.equal(archiveResult.errorMessage, "Stop the active timer before archiving this task.");
  assert.equal(state.tasks[0].archived_at, null);
  assert.equal(state.deletes.length, 0);

  const deleteResult = await deleteTaskSafely("task-1", { supabase: supabase as never });
  assert.equal(deleteResult.errorMessage, "Stop the active timer on this task before deleting it.");
  assert.equal(state.deletes.length, 0);
});
