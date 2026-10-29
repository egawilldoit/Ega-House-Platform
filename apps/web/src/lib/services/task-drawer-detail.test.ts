import assert from "node:assert/strict";
import test from "node:test";

import { getTaskDrawerDetail } from "./task-service";

type StubResult = { data: unknown; error: unknown };

/**
 * Minimal stub of the chains `getTaskDrawerDetail` uses, recording the task
 * filters so the owner-scoping assertion is executable rather than prose.
 * Dependency detail is empty here; its own service coverage lives separately.
 */
function stubSupabase(result: StubResult, options: { userId?: string | null } = {}) {
  const filters: Array<{ column: string; value: unknown }> = [];
  const userId = options.userId === undefined ? "owner-1" : options.userId;

  function makeQuery(table: string) {
    const query = {
      eq(column: string, value: unknown) {
        if (table === "tasks") filters.push({ column, value });
        return query;
      },
      is() {
        return query;
      },
      neq() {
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
      async maybeSingle() {
        return result;
      },
      then(resolve: (value: StubResult) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve({ data: [], error: null }).then(resolve, reject);
      },
    };
    return query;
  }

  const client = {
    auth: {
      getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
    from(table: string) {
      return {
        select(columns: string) {
          if (table === "tasks" && columns.includes("description")) {
            assert.ok(columns.includes("start_date"), "selects the drawer projection");
          }
          return makeQuery(table);
        },
      };
    },
  };

  return { client, filters };
}

test("returns the task and filters by id and owner", async () => {
  const row = {
    id: "task-1",
    title: "Draft review",
    status: "in_progress",
    priority: "high",
    start_date: null,
    due_date: null,
    project_id: null,
    goal_id: null,
    archived_at: null,
  };
  const { client, filters } = stubSupabase({ data: row, error: null });

  const detail = await getTaskDrawerDetail("task-1", { supabase: client as never });

  assert.equal(detail.kind, "found");
  assert.deepEqual(detail.kind === "found" ? detail.task : null, {
    ...row,
    dependencies: { blockedBy: [], blocking: [], options: [] },
    dependencyError: null,
  });
  assert.deepEqual(filters.slice(0, 2), [
    { column: "id", value: "task-1" },
    { column: "owner_user_id", value: "owner-1" },
  ]);
});

test("returns null for an unknown id without leaking a different result", async () => {
  const { client } = stubSupabase({ data: null, error: null });
  assert.deepEqual(await getTaskDrawerDetail("unknown", { supabase: client as never }), {
    kind: "unavailable",
  });
});

test("another owner's task is indistinguishable from a missing one", async () => {
  // RLS yields zero rows (not an error) for another owner's id.
  const missing = stubSupabase({ data: null, error: null });
  const otherOwner = stubSupabase({ data: null, error: null });

  const a = await getTaskDrawerDetail("task-of-other-owner", { supabase: otherOwner.client as never });
  const b = await getTaskDrawerDetail("does-not-exist", { supabase: missing.client as never });

  assert.deepEqual(a, { kind: "unavailable" });
  assert.deepEqual(b, { kind: "unavailable" });
  assert.deepEqual(a, b);
});

test("returns null without querying when there is no authenticated user", async () => {
  const { client, filters } = stubSupabase({ data: null, error: null }, { userId: null });

  assert.deepEqual(await getTaskDrawerDetail("task-1", { supabase: client as never }), {
    kind: "unavailable",
  });
  assert.deepEqual(filters, []);
});

test("returns unavailable for a blank id without querying", async () => {
  const { client, filters } = stubSupabase({ data: null, error: null });
  assert.deepEqual(await getTaskDrawerDetail("   ", { supabase: client as never }), {
    kind: "unavailable",
  });
  assert.deepEqual(filters, []);
});

test("reports an operational query failure instead of claiming the task is gone", async () => {
  const { client } = stubSupabase({ data: null, error: { message: "statement timeout" } });
  assert.deepEqual(await getTaskDrawerDetail("task-1", { supabase: client as never }), {
    kind: "error",
  });
});
