import assert from "node:assert/strict";
import test from "node:test";

import {
  moveTaskOnBoardForOwner,
  planBoardMove,
  type BoardColumnEntry,
} from "./task-board-service";

const OWNER = "owner-1";

type TaskRow = {
  id: string;
  status: string;
  priority: string;
  due_date: string | null;
  estimate_minutes: number | null;
  blocked_reason: string | null;
  archived_at: string | null;
  updated_at: string;
  board_rank: string | null;
  owner_user_id?: string;
  project_id?: string;
  goal_id?: string | null;
  completed_at?: string | null;
};

function buildTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "task-1",
    status: "todo",
    priority: "medium",
    due_date: null,
    estimate_minutes: null,
    blocked_reason: null,
    archived_at: null,
    updated_at: "2026-10-28T10:00:00.000Z",
    board_rank: "A",
    owner_user_id: OWNER,
    project_id: "project-1",
    goal_id: null,
    completed_at: null,
    ...overrides,
  };
}

function stubSupabase(input: {
  userId?: string | null;
  task?: TaskRow | null;
  column?: BoardColumnEntry[];
  currentSelectError?: unknown;
  columnSelectError?: unknown;
  updateError?: unknown;
  updatedRow?: { id: string } | null;
}) {
  const updates: Array<Record<string, unknown>> = [];
  const guards: Array<{ column: string; value: unknown }> = [];
  const userId = input.userId === undefined ? OWNER : input.userId;

  const client = {
    auth: {
      getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
    from(table: string) {
      assert.equal(table, "tasks");
      return {
        select(columns: string) {
          if (columns.trim() === "id, board_rank") {
            const query = {
              eq() {
                return query;
              },
              is() {
                return query;
              },
              order() {
                return query;
              },
              then(resolve: (value: unknown) => unknown) {
                return Promise.resolve(
                  resolve({
                    data: input.columnSelectError ? null : input.column ?? [],
                    error: input.columnSelectError ?? null,
                  }),
                );
              },
            };
            return query;
          }

          const query = {
            eq(column: string, value: unknown) {
              guards.push({ column, value });
              return query;
            },
            async maybeSingle() {
              return {
                data: input.currentSelectError ? null : input.task ?? null,
                error: input.currentSelectError ?? null,
              };
            },
          };
          return query;
        },
        update(payload: Record<string, unknown>) {
          updates.push(payload);
          const query = {
            eq(column: string, value: unknown) {
              guards.push({ column, value });
              return query;
            },
            select() {
              const selectQuery = {
                async maybeSingle() {
                  return {
                    data: input.updateError ? null : input.updatedRow ?? { id: "task-1" },
                    error: input.updateError ?? null,
                  };
                },
              };
              return selectQuery;
            },
          };
          return query;
        },
      };
    },
  };

  return { client, updates, guards };
}

const column: BoardColumnEntry[] = [
  { id: "a", board_rank: "A" },
  { id: "b", board_rank: "B" },
];

test("planner inserts between visible neighbours and ignores hidden rows for visibility", () => {
  // `hidden` sits between `a` and `b` canonically but is filtered out of the view.
  const plan = planBoardMove({
    column: [
      { id: "a", board_rank: "A" },
      { id: "hidden", board_rank: "AF" },
      { id: "b", board_rank: "B" },
    ],
    beforeTaskId: "a",
    afterTaskId: "b",
    expectedBeforeRank: "A",
    expectedAfterRank: "B",
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.ok(plan.boardRank && plan.boardRank > "A" && plan.boardRank < "B");
});

test("planner refuses stale neighbour ranks and out-of-order neighbours", () => {
  const stale = planBoardMove({
    column,
    beforeTaskId: "a",
    afterTaskId: "b",
    expectedBeforeRank: "Z",
    expectedAfterRank: "B",
  });
  assert.equal(stale.ok, false);

  const outOfOrder = planBoardMove({
    column,
    beforeTaskId: "b",
    afterTaskId: "a",
    expectedBeforeRank: "B",
    expectedAfterRank: "A",
  });
  assert.equal(outOfOrder.ok, false);

  const missing = planBoardMove({
    column,
    beforeTaskId: "missing",
    afterTaskId: "b",
    expectedBeforeRank: "A",
    expectedAfterRank: "B",
  });
  assert.equal(missing.ok, false);
});

test("planner appends to the end and never invents a key outside its neighbours", () => {
  const append = planBoardMove({
    column,
    beforeTaskId: "b",
    afterTaskId: null,
    expectedBeforeRank: "B",
    expectedAfterRank: null,
  });
  assert.deepEqual(append, { ok: true, boardRank: "C" });

  const empty = planBoardMove({
    column: [],
    beforeTaskId: null,
    afterTaskId: null,
    expectedBeforeRank: null,
    expectedAfterRank: null,
  });
  assert.deepEqual(empty, { ok: true, boardRank: null });
});

test("rejects an unauthenticated caller before touching a task", async () => {
  const { client, updates } = stubSupabase({ userId: null });
  const result = await moveTaskOnBoardForOwner(
    { taskId: "task-1", toStatus: "in_progress" },
    { supabase: client as never },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid");
  assert.equal(updates.length, 0);
});

test("rejects malformed status, ids and missing neighbour ranks", async () => {
  const { client, updates } = stubSupabase({ task: buildTask() });

  const badStatus = await moveTaskOnBoardForOwner(
    { taskId: "task-1", toStatus: "shipping" },
    { supabase: client as never },
  );
  assert.equal(badStatus.ok, false);

  const selfNeighbour = await moveTaskOnBoardForOwner(
    {
      taskId: "task-1",
      toStatus: "todo",
      beforeTaskId: "task-1",
      expectedBeforeRank: "A",
    },
    { supabase: client as never },
  );
  assert.equal(selfNeighbour.ok, false);

  const noRank = await moveTaskOnBoardForOwner(
    {
      taskId: "task-1",
      toStatus: "todo",
      beforeTaskId: "a",
      expectedBeforeRank: null,
    },
    { supabase: client as never },
  );
  assert.equal(noRank.ok, false);
  assert.equal(updates.length, 0);
});

test("refuses archived tasks and transitions outside the canonical matrix", async () => {
  const archived = stubSupabase({
    task: buildTask({ archived_at: "2026-10-01T00:00:00.000Z" }),
  });
  const archivedResult = await moveTaskOnBoardForOwner(
    { taskId: "task-1", toStatus: "in_progress" },
    { supabase: archived.client as never },
  );
  assert.equal(archivedResult.ok, false);
  assert.equal(archivedResult.code, "invalid");

  const forbidden = stubSupabase({ task: buildTask({ status: "done" }) });
  const forbiddenResult = await moveTaskOnBoardForOwner(
    { taskId: "task-1", toStatus: "in_progress" },
    { supabase: forbidden.client as never },
  );
  assert.equal(forbiddenResult.ok, false);
  assert.equal(forbiddenResult.code, "forbidden_transition");
  assert.equal(forbidden.updates.length, 0);
});

test("blocked moves require a reason unless the task already has one", async () => {
  const missing = stubSupabase({ task: buildTask({ status: "todo" }) });
  const missingResult = await moveTaskOnBoardForOwner(
    { taskId: "task-1", toStatus: "blocked" },
    { supabase: missing.client as never },
  );
  assert.equal(missingResult.ok, false);
  assert.equal(missingResult.code, "blocked_reason_required");
  assert.equal(missing.updates.length, 0);
});

test("a stale card version is a retryable conflict without a write", async () => {
  const { client, updates } = stubSupabase({ task: buildTask() });
  const result = await moveTaskOnBoardForOwner(
    {
      taskId: "task-1",
      toStatus: "todo",
      expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
    },
    { supabase: client as never },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "conflict");
  assert.equal(result.retryable, true);
  assert.equal(updates.length, 0);
});

test("a stale neighbour rank refuses the move without a write", async () => {
  const { client, updates } = stubSupabase({
    task: buildTask(),
    column: [
      { id: "a", board_rank: "A2" },
      { id: "b", board_rank: "B" },
    ],
  });
  const result = await moveTaskOnBoardForOwner(
    {
      taskId: "task-1",
      toStatus: "todo",
      beforeTaskId: "a",
      afterTaskId: "b",
      expectedBeforeRank: "A",
      expectedAfterRank: "B",
      expectedUpdatedAt: "2026-10-28T10:00:00.000Z",
    },
    { supabase: client as never },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "conflict");
  assert.equal(updates.length, 0);
});

test("a successful cross-column move writes status and rank in one guarded update", async () => {
  const { client, updates, guards } = stubSupabase({
    task: buildTask({ status: "todo", board_rank: "Z" }),
    column: [
      { id: "a", board_rank: "A" },
      { id: "b", board_rank: "B" },
    ],
  });
  const result = await moveTaskOnBoardForOwner(
    {
      taskId: "task-1",
      toStatus: "in_progress",
      beforeTaskId: "a",
      afterTaskId: "b",
      expectedBeforeRank: "A",
      expectedAfterRank: "B",
      expectedUpdatedAt: "2026-10-28T10:00:00.000Z",
    },
    { supabase: client as never },
  );

  assert.equal(result.ok, true, result.ok ? "" : result.message);
  assert.equal(updates.length, 1);
  const payload = updates[0] ?? {};
  assert.equal(payload.status, "in_progress");
  assert.ok(typeof payload.board_rank === "string");
  assert.ok(
    (payload.board_rank as string) > "A" && (payload.board_rank as string) < "B",
  );
  assert.equal(typeof payload.updated_at, "string");
  assert.deepEqual(
    guards.filter((guard) => guard.column === "updated_at"),
    [{ column: "updated_at", value: "2026-10-28T10:00:00.000Z" }],
  );
  assert.ok(guards.some((guard) => guard.column === "owner_user_id" && guard.value === OWNER));
});

test("an empty target column leaves the append rank to the database trigger", async () => {
  const { client, updates } = stubSupabase({
    task: buildTask({ status: "todo" }),
    column: [],
  });
  const result = await moveTaskOnBoardForOwner(
    { taskId: "task-1", toStatus: "in_progress" },
    { supabase: client as never },
  );
  assert.equal(result.ok, true);
  assert.equal(updates[0]?.board_rank, null);
});

test("a cross-column move whose target rank equals the old rank still changes the key", () => {
  // Backfill gives every column identical keys, so the target gap can compute
  // exactly the card's existing rank. Sending it unchanged would make the
  // trigger treat the move as "no explicit rank" and append the card instead.
  const plan = planBoardMove({
    column: [
      { id: "a", board_rank: "A" },
      { id: "b", board_rank: "B" },
    ],
    beforeTaskId: "a",
    afterTaskId: "b",
    expectedBeforeRank: "A",
    expectedAfterRank: "B",
    mustDifferFrom: "AI",
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.notEqual(plan.boardRank, "AI");
  assert.ok(plan.boardRank && plan.boardRank > "A" && plan.boardRank < "B");
});

test("the service sends an explicit rank that differs from the card's previous column rank", async () => {
  const { client, updates } = stubSupabase({
    task: buildTask({ status: "todo", board_rank: "AI" }),
    column: [
      { id: "a", board_rank: "A" },
      { id: "b", board_rank: "B" },
    ],
  });
  const result = await moveTaskOnBoardForOwner(
    {
      taskId: "task-1",
      toStatus: "in_progress",
      beforeTaskId: "a",
      afterTaskId: "b",
      expectedBeforeRank: "A",
      expectedAfterRank: "B",
      expectedUpdatedAt: "2026-10-28T10:00:00.000Z",
    },
    { supabase: client as never },
  );

  assert.equal(result.ok, true, result.ok ? "" : result.message);
  const payload = updates[0] ?? {};
  assert.equal(payload.status, "in_progress");
  assert.notEqual(payload.board_rank, "AI");
  assert.ok(
    (payload.board_rank as string) > "A" && (payload.board_rank as string) < "B",
  );
});
