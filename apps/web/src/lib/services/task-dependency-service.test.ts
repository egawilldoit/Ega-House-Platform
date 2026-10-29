import assert from "node:assert/strict";
import test from "node:test";

import {
  addTaskDependency,
  getTaskDependencyDetail,
  removeTaskDependency,
} from "./task-dependency-service";

type Row = Record<string, unknown>;

type MockState = {
  userId: string | null;
  tasks: Row[];
  edges: Row[];
  inserts: Row[];
  deletes: Array<{ table: string; filters: Array<{ column: string; value: unknown }> }>;
};

function makeThenable(
  rows: Row[],
  onEq?: (column: string, value: unknown) => void,
) {
  const query = {
    eq(column: string, value: unknown) {
      onEq?.(column, value);
      return query;
    },
    in() {
      return query;
    },
    or() {
      return query;
    },
    order() {
      return query;
    },
    limit() {
      return query;
    },
    then(
      resolve: (value: { data: Row[]; error: null }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
    },
  };
  return query;
}

function makeClient(state: MockState) {
  function selectRows(table: string, filters: Array<{ column: string; value: unknown }>) {
    const source = table === "tasks" ? state.tasks : state.edges;
    return source.filter((row) =>
      filters.every((filter) =>
        filter.column === "id" && Array.isArray(filter.value)
          ? (filter.value as unknown[]).includes(row.id)
          : row[filter.column] === filter.value,
      ),
    );
  }

  return {
    auth: {
      getUser: async () => ({ data: { user: state.userId ? { id: state.userId } : null }, error: null }),
    },
    from(table: string) {
      const filters: Array<{ column: string; value: unknown }> = [];
      const query = {
        select() {
          return query;
        },
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return query;
        },
        in(column: string, value: unknown[]) {
          filters.push({ column, value });
          return query;
        },
        is() {
          return query;
        },
        neq() {
          return query;
        },
        or() {
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        async maybeSingle() {
          return { data: selectRows(table, filters)[0] ?? null, error: null };
        },
        then(resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve({ data: selectRows(table, filters), error: null }).then(resolve, reject);
        },
        insert(payload: Row) {
          state.inserts.push({ table, ...payload });
          return Promise.resolve({ error: null });
        },
        delete() {
          const record = { table, filters: [] as Array<{ column: string; value: unknown }> };
          state.deletes.push(record);
          return makeThenable([], (column, value) => record.filters.push({ column, value }));
        },
      };
      return query;
    },
  };
}

function createState(overrides: Partial<MockState> = {}): MockState {
  return {
    userId: "owner-1",
    tasks: [
      { id: "task-a", owner_user_id: "owner-1", title: "A" },
      { id: "task-b", owner_user_id: "owner-1", title: "B" },
      { id: "task-c", owner_user_id: "owner-1", title: "C" },
      { id: "task-x", owner_user_id: "owner-2", title: "X" },
    ],
    edges: [],
    inserts: [],
    deletes: [],
    ...overrides,
  };
}

test("rejects self dependencies before touching persistence", async () => {
  const state = createState();
  const result = await addTaskDependency(
    { taskId: "task-a", blockedByTaskId: "task-a" },
    { supabase: makeClient(state) as never },
  );
  assert.equal(result.errorMessage, "A task cannot be blocked by itself.");
  assert.equal(state.inserts.length, 0);
});

test("rejects a forged cross-owner endpoint", async () => {
  const state = createState();
  const result = await addTaskDependency(
    { taskId: "task-a", blockedByTaskId: "task-x" },
    { supabase: makeClient(state) as never },
  );
  assert.equal(result.errorMessage, "Selected task is unavailable.");
  assert.equal(state.inserts.length, 0);
});

test("rejects a duplicate edge", async () => {
  const state = createState({
    edges: [{ owner_user_id: "owner-1", task_id: "task-b", blocked_by_task_id: "task-a" }],
  });
  const result = await addTaskDependency(
    { taskId: "task-b", blockedByTaskId: "task-a" },
    { supabase: makeClient(state) as never },
  );
  assert.equal(result.errorMessage, "That dependency already exists.");
  assert.equal(state.inserts.length, 0);
});

test("rejects a direct reverse edge with the domain precheck", async () => {
  const state = createState({
    edges: [{ owner_user_id: "owner-1", task_id: "task-b", blocked_by_task_id: "task-a" }],
  });
  const result = await addTaskDependency(
    { taskId: "task-a", blockedByTaskId: "task-b" },
    { supabase: makeClient(state) as never },
  );
  assert.equal(result.errorMessage, "That dependency would create a cycle.");
  assert.equal(state.inserts.length, 0);
});

test("rejects an indirect cycle across a chain", async () => {
  const state = createState({
    edges: [
      { owner_user_id: "owner-1", task_id: "task-b", blocked_by_task_id: "task-a" },
      { owner_user_id: "owner-1", task_id: "task-c", blocked_by_task_id: "task-b" },
    ],
  });
  const result = await addTaskDependency(
    { taskId: "task-a", blockedByTaskId: "task-c" },
    { supabase: makeClient(state) as never },
  );
  assert.equal(result.errorMessage, "That dependency would create a cycle.");
  assert.equal(state.inserts.length, 0);
});

test("adds an edge with the verified owner id, never a submitted owner", async () => {
  const state = createState();
  const result = await addTaskDependency(
    { taskId: "task-c", blockedByTaskId: "task-a" },
    { supabase: makeClient(state) as never },
  );
  assert.equal(result.errorMessage, null);
  assert.deepEqual(state.inserts, [
    {
      table: "task_dependencies",
      owner_user_id: "owner-1",
      task_id: "task-c",
      blocked_by_task_id: "task-a",
    },
  ]);
});

test("removal is always scoped to the verified owner, task and predecessor", async () => {
  const state = createState();
  const result = await removeTaskDependency(
    { taskId: "task-c", blockedByTaskId: "task-a" },
    { supabase: makeClient(state) as never },
  );
  assert.equal(result.errorMessage, null);
  assert.deepEqual(state.deletes, [
    {
      table: "task_dependencies",
      filters: [
        { column: "owner_user_id", value: "owner-1" },
        { column: "task_id", value: "task-c" },
        { column: "blocked_by_task_id", value: "task-a" },
      ],
    },
  ]);
});

test("detail resolves blocked-by and blocking references for the owner", async () => {
  const state = createState({
    edges: [
      { owner_user_id: "owner-1", task_id: "task-a", blocked_by_task_id: "task-b" },
      { owner_user_id: "owner-1", task_id: "task-c", blocked_by_task_id: "task-a" },
      { owner_user_id: "owner-1", task_id: "task-a", blocked_by_task_id: "task-x" },
    ],
  });
  const result = await getTaskDependencyDetail("task-a", {
    supabase: makeClient(state) as never,
  });
  assert.equal(result.errorMessage, null);
  assert.ok(result.data);
  assert.deepEqual(
    result.data.blockedBy.map((item) => item.id),
    ["task-b", "task-x"],
  );
  assert.deepEqual(
    result.data.blocking.map((item) => item.id),
    ["task-c"],
  );
  // task-x belongs to another owner but the mocked edge leaked it; the detail
  // must not invent a title it did not fetch under the owner filter.
  assert.equal(result.data.blockedBy.find((item) => item.id === "task-x")?.title, null);
});
