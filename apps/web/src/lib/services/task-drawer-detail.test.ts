import assert from "node:assert/strict";
import test from "node:test";

import { getTaskDrawerDetail } from "./task-service";

type StubResult = { data: unknown; error: unknown };

type StubSession = {
  task_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
};

/**
 * Minimal stub of the chains `getTaskDrawerDetail` uses, recording the task
 * filters so the owner-scoping assertion is executable rather than prose.
 * Dependency detail is empty here; its own service coverage lives separately.
 * Session filters are recorded separately because only the task query carries
 * the explicit owner filter (sessions are RLS-scoped).
 */
function stubSupabase(
  result: StubResult,
  options: {
    userId?: string | null;
    sessions?: StubSession[];
    sessionsError?: unknown;
  } = {},
) {
  const filters: Array<{ column: string; value: unknown }> = [];
  const sessionFilters: Array<{ column: string; values: unknown[] }> = [];
  const userId = options.userId === undefined ? "owner-1" : options.userId;
  const pageSize = 1000;

  function makeTaskQuery() {
    const query = {
      eq(column: string, value: unknown) {
        filters.push({ column, value });
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

  function makeSessionQuery() {
    let from = 0;
    const query = {
      in(column: string, values: unknown[]) {
        sessionFilters.push({ column, values });
        return query;
      },
      order() {
        return query;
      },
      range(start: number) {
        from = start;
        return query;
      },
      then(resolve: (value: StubResult) => unknown, reject?: (reason: unknown) => unknown) {
        const rows = options.sessions ?? [];
        const page = rows.slice(from, from + pageSize);
        return Promise.resolve({
          data: page,
          error: options.sessionsError ?? null,
        }).then(resolve, reject);
      },
    };
    return query;
  }

  const client = {
    auth: {
      getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
    from(table: string) {
      if (table === "task_sessions") {
        return {
          select(columns: string) {
            assert.ok(columns.includes("duration_seconds"), "selects canonical duration columns");
            return makeSessionQuery();
          },
        };
      }

      return {
        select(columns: string) {
          if (table === "tasks" && columns.includes("description")) {
            assert.ok(columns.includes("start_date"), "selects the drawer projection");
          }
          return makeTaskQuery();
        },
      };
    },
  };

  return { client, filters, sessionFilters };
}

const taskRow = {
  id: "task-1",
  title: "Draft review",
  status: "in_progress",
  priority: "high",
  start_date: null,
  due_date: null,
  project_id: null,
  goal_id: null,
  archived_at: null,
  estimate_minutes: 60,
};

test("returns the task with canonical tracked total, dependencies and owner filters", async () => {
  const { client, filters, sessionFilters } = stubSupabase(
    { data: taskRow, error: null },
    {
      sessions: [
        {
          task_id: "task-1",
          started_at: "2026-04-20T09:00:00.000Z",
          ended_at: "2026-04-20T09:30:00.000Z",
          duration_seconds: 1800,
        },
      ],
    },
  );

  const detail = await getTaskDrawerDetail("task-1", { supabase: client as never });

  assert.equal(detail.kind, "found");
  assert.deepEqual(detail.kind === "found" ? detail.task : null, {
    ...taskRow,
    dependencies: { blockedBy: [], blocking: [], options: [] },
    dependencyError: null,
    tracked_seconds: 1800,
    has_open_session: false,
  });
  assert.deepEqual(filters.slice(0, 2), [
    { column: "id", value: "task-1" },
    { column: "owner_user_id", value: "owner-1" },
  ]);
  assert.deepEqual(sessionFilters, [{ column: "task_id", values: ["task-1"] }]);
});

test("marks a running session so the total is not presented as final", async () => {
  const { client } = stubSupabase(
    { data: taskRow, error: null },
    {
      sessions: [
        {
          task_id: "task-1",
          started_at: "2020-04-20T09:00:00.000Z",
          ended_at: null,
          duration_seconds: null,
        },
      ],
    },
  );

  const detail = await getTaskDrawerDetail("task-1", { supabase: client as never });
  assert.equal(detail.kind, "found");
  if (detail.kind !== "found") return;
  // An open session is measured until "now"; assert the policy flag and a
  // positive contribution instead of a clock-dependent second count.
  assert.equal(detail.task.has_open_session, true);
  assert.ok((detail.task.tracked_seconds ?? 0) > 0);
});

test("does not fabricate zero tracked time when the session query fails", async () => {
  const { client } = stubSupabase(
    { data: taskRow, error: null },
    { sessionsError: { message: "statement timeout" } },
  );

  const detail = await getTaskDrawerDetail("task-1", { supabase: client as never });
  assert.equal(detail.kind, "found");
  if (detail.kind !== "found") return;
  assert.equal(detail.task.tracked_seconds, null);
  assert.equal(detail.task.has_open_session, false);
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
  const { client, filters, sessionFilters } = stubSupabase(
    { data: null, error: null },
    { userId: null },
  );

  assert.deepEqual(await getTaskDrawerDetail("task-1", { supabase: client as never }), {
    kind: "unavailable",
  });
  assert.deepEqual(filters, []);
  assert.deepEqual(sessionFilters, []);
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
