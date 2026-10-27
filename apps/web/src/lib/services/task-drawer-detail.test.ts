import assert from "node:assert/strict";
import test from "node:test";

import { getTaskDrawerDetail } from "./task-service";

type StubResult = { data: unknown; error: unknown };

/**
 * Minimal stub of the chain `getTaskDrawerDetail` uses, recording the filters so
 * the owner-scoping assertion is executable rather than prose.
 */
function stubSupabase(result: StubResult, options: { userId?: string | null } = {}) {
  const filters: Array<{ column: string; value: unknown }> = [];
  const userId = options.userId === undefined ? "owner-1" : options.userId;

  const client = {
    auth: {
      getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
    from(table: string) {
      assert.equal(table, "tasks");
      return {
        select(columns: string) {
          assert.ok(columns.includes("title"), "selects the drawer projection");
          const query = {
            eq(column: string, value: unknown) {
              filters.push({ column, value });
              return query;
            },
            async maybeSingle() {
              return result;
            },
          };
          return query;
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
    due_date: null,
    project_id: null,
    goal_id: null,
    archived_at: null,
  };
  const { client, filters } = stubSupabase({ data: row, error: null });

  const detail = await getTaskDrawerDetail("task-1", { supabase: client as never });

  assert.equal(detail.kind, "found");
  assert.deepEqual(detail.kind === "found" ? detail.task : null, row);
  assert.deepEqual(filters, [
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
