import assert from "node:assert/strict";
import test from "node:test";

import {
  getWorkActivityCompletionEvents,
  getWorkActivityDayDetails,
  getWorkActivitySessionsForYear,
} from "./work-activity-data-adapter";

type CapturedQuery = {
  table: string;
  filters: Array<{ method: string; args: unknown[] }>;
};

type QueryResult = {
  data: unknown[] | null;
  error: { message: string } | null;
};

function createSupabaseMock(queryResults: QueryResult[]) {
  const queries: CapturedQuery[] = [];
  let index = 0;

  function createChain(captured: CapturedQuery) {
    const result = queryResults[index];
    index += 1;
    assert.ok(result, `Unexpected query invocation (index ${index}).`);

    const method =
      (name: string) =>
      (...args: unknown[]) => {
        captured.filters.push({ method: name, args });
        return chain;
      };

    const chain = {
      eq: method("eq"),
      neq: method("neq"),
      gte: method("gte"),
      gt: method("gt"),
      lt: method("lt"),
      lte: method("lte"),
      or: method("or"),
      is: method("is"),
      not: method("not"),
      order: method("order"),
      limit: method("limit"),
      in: method("in"),
      select: method("select"),
      then(resolve: (value: QueryResult) => void) {
        resolve(result);
      },
    };

    return chain;
  }

  const client = {
    from(table: string) {
      const captured: CapturedQuery = { table, filters: [] };
      queries.push(captured);
      return {
        select(_columns: string, _opts?: unknown) {
          return createChain(captured);
        },
      };
    },
  };

  return { client: client as never, queries };
}

const yearWindow = {
  startIso: "2025-09-28T00:00:00.000Z",
  endIso: "2026-09-27T00:00:00.000Z",
};

test("getWorkActivitySessionsForYear queries task_sessions with owner + overlap window", async () => {
  const { client, queries } = createSupabaseMock([
    { data: [{ task_id: "t1", started_at: "2026-01-01T10:00:00Z", ended_at: null }], error: null },
  ]);

  const result = await getWorkActivitySessionsForYear({
    ownerUserId: "user-1",
    window: yearWindow,
    supabase: client,
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.length, 1);
  assert.equal(queries.length, 1);
  assert.equal(queries[0]?.table, "task_sessions");

  const filters = queries[0]?.filters ?? [];
  const eqOwner = filters.find((f) => f.method === "eq" && f.args[0] === "owner_user_id");
  assert.ok(eqOwner, "must scope by owner_user_id");
  assert.deepEqual(eqOwner?.args[1], "user-1");

  const ltStarted = filters.find((f) => f.method === "lt" && f.args[0] === "started_at");
  assert.ok(ltStarted, "must bound started_at < window end");
  assert.deepEqual(ltStarted?.args[1], yearWindow.endIso);

  const orOverlap = filters.find((f) => f.method === "or");
  assert.ok(orOverlap, "must apply overlap semantics (ended_at IS NULL OR ended_at >= start)");
  assert.ok(
    String(orOverlap?.args[0] ?? "").includes("ended_at.is.null"),
    "or filter must include ended_at.is.null",
  );
  assert.ok(
    String(orOverlap?.args[0] ?? "").includes(`ended_at.gte.${yearWindow.startIso}`),
    `or filter must include ended_at.gte.${yearWindow.startIso}`,
  );
});

test("getWorkActivitySessionsForYear returns error on invalid window", async () => {
  const { client } = createSupabaseMock([]);
  const result = await getWorkActivitySessionsForYear({
    ownerUserId: "user-1",
    window: { startIso: "not-a-date", endIso: yearWindow.endIso },
    supabase: client,
  });
  assert.equal(result.data, null);
  assert.match(result.errorMessage ?? "", /Invalid window/);
});

test("getWorkActivitySessionsForYear surfaces query errors", async () => {
  const { client } = createSupabaseMock([{ data: null, error: { message: "boom" } }]);
  const result = await getWorkActivitySessionsForYear({
    ownerUserId: "user-1",
    window: yearWindow,
    supabase: client,
  });
  assert.equal(result.data, null);
  assert.match(result.errorMessage ?? "", /Failed to load work activity sessions/);
});

test("getWorkActivityCompletionEvents queries task_status_events with done + occurred_at window", async () => {
  const { client, queries } = createSupabaseMock([
    { data: [{ occurred_at: "2026-02-20T10:00:00Z", task_id: "t1" }], error: null },
  ]);

  const result = await getWorkActivityCompletionEvents({
    ownerUserId: "user-1",
    window: yearWindow,
    supabase: client,
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.length, 1);
  assert.equal(queries.length, 1);
  assert.equal(queries[0]?.table, "task_status_events");

  const filters = queries[0]?.filters ?? [];
  const eqOwner = filters.find((f) => f.method === "eq" && f.args[0] === "owner_user_id");
  assert.ok(eqOwner, "must scope by owner_user_id");
  const eqDone = filters.find((f) => f.method === "eq" && f.args[0] === "to_status");
  assert.ok(eqDone, "must filter to_status = done");
  assert.deepEqual(eqDone?.args[1], "done");
  const gteOccurred = filters.find((f) => f.method === "gte" && f.args[0] === "occurred_at");
  assert.ok(gteOccurred, "must bound occurred_at >= window start");
  assert.deepEqual(gteOccurred?.args[1], yearWindow.startIso);
  const ltOccurred = filters.find((f) => f.method === "lt" && f.args[0] === "occurred_at");
  assert.ok(ltOccurred, "must bound occurred_at < window end");
  assert.deepEqual(ltOccurred?.args[1], yearWindow.endIso);
});

test("getWorkActivityDayDetails fetches sessions + completion events + task metadata for one day", async () => {
  const dayWindow = {
    startIso: "2026-09-27T00:00:00.000Z",
    endIso: "2026-09-28T00:00:00.000Z",
  };
  const { client, queries } = createSupabaseMock([
    {
      data: [
        {
          task_id: "t1",
          started_at: "2026-09-27T01:00:00Z",
          ended_at: "2026-09-27T02:00:00Z",
          duration_seconds: 3600,
          tasks: { id: "t1", title: "Deep work", project_id: "p1", goal_id: null, projects: { id: "p1", name: "EGA" }, goals: null },
        },
      ],
      error: null,
    },
    { data: [{ occurred_at: "2026-09-27T10:00:00Z", task_id: "t2" }], error: null },
    {
      data: [
        { id: "t2", title: "Ship it", project_id: "p1", goal_id: "g1", projects: { id: "p1", name: "EGA" }, goals: { id: "g1", title: "Launch" } },
      ],
      error: null,
    },
  ]);

  const result = await getWorkActivityDayDetails({
    ownerUserId: "user-1",
    dayWindow,
    supabase: client,
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.sessions.length, 1);
  assert.equal(result.data?.completedTasks.length, 1);
  assert.equal(result.data?.completedTasks[0]?.title, "Ship it");
  assert.equal(result.data?.completedTasks[0]?.projectName, "EGA");
  assert.equal(result.data?.completedTasks[0]?.goalTitle, "Launch");
  assert.equal(result.data?.completedTasks[0]?.completedAt, "2026-09-27T10:00:00Z");

  assert.equal(queries.length, 3);
  assert.equal(queries[0]?.table, "task_sessions");
  assert.equal(queries[1]?.table, "task_status_events");
  assert.equal(queries[2]?.table, "tasks");

  const taskFilter = queries[2]?.filters.find((f) => f.method === "in" && f.args[0] === "id");
  assert.ok(taskFilter, "must fetch task metadata by ids");
  assert.deepEqual(taskFilter?.args[1], ["t2"]);
});

test("getWorkActivityDayDetails returns empty completed tasks when no completion events", async () => {
  const dayWindow = {
    startIso: "2026-09-27T00:00:00.000Z",
    endIso: "2026-09-28T00:00:00.000Z",
  };
  const { client, queries } = createSupabaseMock([
    { data: [], error: null },
    { data: [], error: null },
  ]);

  const result = await getWorkActivityDayDetails({
    ownerUserId: "user-1",
    dayWindow,
    supabase: client,
  });

  assert.equal(result.errorMessage, null);
  assert.deepEqual(result.data?.sessions, []);
  assert.deepEqual(result.data?.completedTasks, []);
  assert.equal(queries.length, 2, "must not query tasks when there are no completion events");
});

test("getWorkActivityDayDetails clips midnight-spanning and open sessions to the day window", async () => {
  const dayWindow = {
    startIso: "2026-09-27T00:00:00.000Z",
    endIso: "2026-09-28T00:00:00.000Z",
  };
  const { client } = createSupabaseMock([
    {
      data: [
        {
          task_id: "t1",
          started_at: "2026-09-26T23:00:00.000Z",
          ended_at: "2026-09-27T01:30:00.000Z",
          duration_seconds: 9000,
          tasks: { id: "t1", title: "Spanning", project_id: null, goal_id: null, estimate_minutes: 120, projects: null, goals: null },
        },
        {
          task_id: "t2",
          started_at: "2026-09-27T10:00:00.000Z",
          ended_at: null,
          duration_seconds: null,
          tasks: { id: "t2", title: "Open", project_id: null, goal_id: null, estimate_minutes: null, projects: null, goals: null },
        },
      ],
      error: null,
    },
    { data: [], error: null },
  ]);

  const result = await getWorkActivityDayDetails({
    ownerUserId: "user-1",
    dayWindow,
    now: new Date("2026-09-27T12:00:00.000Z"),
    supabase: client,
  });

  assert.equal(result.errorMessage, null);
  const spanning = result.data?.sessions.find((s) => s.task_id === "t1");
  // 23:00→24:00 belongs to the previous local day; only 00:00→01:30 counts here.
  assert.equal(spanning?.duration_seconds, 5400);
  const open = result.data?.sessions.find((s) => s.task_id === "t2");
  // An open session is bounded by the injected now: 10:00→12:00.
  assert.equal(open?.duration_seconds, 7200);
});

test("getWorkActivityDayDetails surfaces session query errors", async () => {
  const { client } = createSupabaseMock([{ data: null, error: { message: "boom" } }]);
  const result = await getWorkActivityDayDetails({
    ownerUserId: "user-1",
    dayWindow: { startIso: "2026-09-27T00:00:00.000Z", endIso: "2026-09-28T00:00:00.000Z" },
    supabase: client,
  });
  assert.equal(result.data, null);
  assert.match(result.errorMessage ?? "", /Failed to load work activity day sessions/);
});
