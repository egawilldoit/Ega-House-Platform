import assert from "node:assert/strict";
import test from "node:test";

import {
  BULK_TASK_LIMIT,
  bulkArchiveTasksForOwner,
  bulkPatchTasksForOwner,
  undoTaskOperationForOwner,
} from "./task-bulk-service";

type Row = Record<string, unknown> | null;

function stubSupabase(options: {
  userId?: string | null;
  task?: Row;
  receipts?: Array<Record<string, unknown>>;
  insertError?: unknown;
} = {}) {
  const inserted: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const userId = options.userId === undefined ? "owner-1" : options.userId;

  const client = {
    auth: {
      getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
    from(table: string) {
      if (table === "task_operation_receipts") {
        return {
          insert: async (row: Record<string, unknown>) => {
            inserted.push(row);
            return { error: options.insertError ?? null };
          },
          select() {
            const query = {
              eq() {
                return query;
              },
              then(resolve: (value: unknown) => unknown) {
                return Promise.resolve(
                  resolve({ data: options.receipts ?? [], error: null }),
                );
              },
            };
            return query;
          },
          update(row: Record<string, unknown>) {
            updates.push(row);
            const query = {
              eq() {
                return query;
              },
              is() {
                return Promise.resolve({ error: null });
              },
            };
            return query;
          },
        };
      }

      return {
        select() {
          const query = {
            eq() {
              return query;
            },
            async maybeSingle() {
              return { data: options.task ?? null, error: null };
            },
          };
          return query;
        },
      };
    },
  };

  return { client, inserted, updates };
}

test("rejects an unsupported field and an empty selection before reading anything", async () => {
  const { client } = stubSupabase();

  const unsupported = await bulkPatchTasksForOwner(
    { taskIds: ["t1"], field: "title", value: "x" },
    { supabase: client as never },
  );
  assert.equal(unsupported.errorMessage, "Unsupported bulk field.");

  const empty = await bulkPatchTasksForOwner(
    { taskIds: [], field: "status", value: "done" },
    { supabase: client as never },
  );
  assert.equal(empty.errorMessage, "Select at least one task.");
});

test("bounds the selection to the documented limit", async () => {
  const { client } = stubSupabase({ userId: null });
  const ids = Array.from({ length: BULK_TASK_LIMIT + 20 }, (_, index) => `t${index}`);

  const result = await bulkPatchTasksForOwner(
    { taskIds: ids, field: "status", value: "todo" },
    { supabase: client as never },
  );

  assert.equal(result.errorMessage, "Task update request is invalid.");
  assert.equal(result.results.length, 0);
});

test("an unauthenticated caller gets no per-task disclosure", async () => {
  const { client } = stubSupabase({ userId: null });
  const result = await bulkPatchTasksForOwner(
    { taskIds: ["t1"], field: "priority", value: "high" },
    { supabase: client as never },
  );

  assert.deepEqual(result.results, []);
  assert.equal(result.errorMessage, "Task update request is invalid.");
});

test("blocked without a reason is ineligible and writes no receipt", async () => {
  const { client, inserted } = stubSupabase({
    task: {
      id: "t1",
      status: "todo",
      priority: "medium",
      due_date: null,
      estimate_minutes: null,
      blocked_reason: null,
      project_id: "p1",
      goal_id: null,
      archived_at: null,
      archived_by: null,
      updated_at: "2026-10-27T10:00:00.000Z",
    },
  });

  const result = await bulkPatchTasksForOwner(
    { taskIds: ["t1"], field: "status", value: "blocked" },
    { supabase: client as never },
  );

  assert.equal(result.applied, 0);
  assert.equal(result.results[0]?.outcome, "ineligible");
  assert.match(result.results[0]?.message ?? "", /blocked reason/i);
  assert.equal(inserted.length, 0);
});

test("archive refuses a task that is already archived", async () => {
  const { client, inserted } = stubSupabase({
    task: {
      id: "t1",
      status: "todo",
      priority: "medium",
      due_date: null,
      estimate_minutes: null,
      blocked_reason: null,
      project_id: "p1",
      goal_id: null,
      archived_at: "2026-10-01T00:00:00.000Z",
      archived_by: "owner-1",
      updated_at: "2026-10-27T10:00:00.000Z",
    },
    receipts: [],
  });

  const result = await bulkArchiveTasksForOwner(
    { taskIds: ["t1"], archived: true },
    { supabase: client as never },
  );

  assert.equal(result.applied, 0);
  assert.equal(result.results[0]?.outcome, "ineligible");
  assert.equal(inserted.length, 0);
});

test("undo without an operation id is rejected", async () => {
  const { client } = stubSupabase();
  const result = await undoTaskOperationForOwner("", { supabase: client as never });
  assert.equal(result.errorMessage, "Undo request is invalid.");
});

test("undo reports expired and already-consumed receipts without touching tasks", async () => {
  const { client } = stubSupabase({
    receipts: [
      {
        id: "r1",
        task_id: "t1",
        before_values: { status: "todo" },
        after_values: { status: "done" },
        expires_at: "2020-01-01T00:00:00.000Z",
        undone_at: null,
      },
      {
        id: "r2",
        task_id: "t2",
        before_values: { status: "todo" },
        after_values: { status: "in_progress" },
        expires_at: "2999-01-01T00:00:00.000Z",
        undone_at: "2026-10-27T10:00:00.000Z",
      },
    ],
  });

  const result = await undoTaskOperationForOwner("op-1", { supabase: client as never });
  assert.deepEqual(result.results.map((entry) => entry.outcome), ["expired", "already_undone"]);
});
