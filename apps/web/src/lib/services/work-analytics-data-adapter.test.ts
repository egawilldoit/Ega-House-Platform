import assert from "node:assert/strict";
import test from "node:test";

import { getCompletedTaskCountForWindow, getWorkAnalyticsSessionsForWindow, getWorkAnalyticsTaskCounts } from "./work-analytics-data-adapter";

type QueryResult = {
  data: unknown[] | null;
  count: number | null;
  error: { code?: string; message: string } | null;
};

/**
 * Creates a mock Supabase client that returns the given query results in order.
 * The mock handles the chained `.from().select().eq().gte().lt().or().is()` pattern
 * used by getWorkAnalyticsTaskCounts.
 *
 * Each element in queryResults corresponds to one awaited `select()` call.
 * Supabase head:true queries return `{ count, data, error }` where `count` is the
 * authoritative total and `data` is null/empty when `head: true` is set.
 * Tests must reproduce that real semantics: `data` is not the count source.
 *
 * The chain methods (eq, gte, lt, or, is) all return the same chain, and `await`
 * on the chain resolves to the next query result.
 */
function createSupabaseMock(queryResults: QueryResult[]) {
  let index = 0;
  const selects: string[] = [];

  function createChain() {
    const result = queryResults[index];
    index += 1;
    assert.ok(result, `Unexpected query invocation (index ${index}).`);

    // Chain methods that return the chain itself for chaining
    const chain = {
      // All filter/query methods return the chain for chaining
      eq: () => chain,
      neq: () => chain,
      gte: () => chain,
      gt: () => chain,
      lt: () => chain,
      lte: () => chain,
      or: () => chain,
      is: () => chain,
      not: () => chain,
      order: () => chain,
      limit: () => chain,

      // The await handler — returns a Promise that resolves to the result
      then(
        resolve: (value: QueryResult) => void,
      ) {
        resolve(result);
      },
    };

    return chain;
  }

  return {
    selects,
    from(_table: string) {
      return {
        select(columns: string, _opts?: unknown) {
          selects.push(columns);
          return createChain();
        },
      };
    },
  };
}

const window = {
  startIso: "2026-04-20T00:00:00.000Z",
  endIso: "2026-04-27T00:00:00.000Z",
};

test("getWorkAnalyticsTaskCounts returns zeros for empty data", async () => {
  const supabase = createSupabaseMock([
    { data: null, count: 0, error: null }, // created
    { data: null, count: 0, error: null }, // completed
    { data: null, count: 0, error: null }, // blocked
  ]);

  const result = await getWorkAnalyticsTaskCounts({
    ownerUserId: "user-1",
    window,
    supabase: supabase as never,
  });

  assert.equal(result.errorMessage, null);
  assert.deepEqual(result.data, { completedCount: 0, createdCount: 0, blockedCount: 0 });
});

test("getWorkAnalyticsTaskCounts counts tasks created inside the window", async () => {
  const supabase = createSupabaseMock([
    { data: null, count: 2, error: null }, // created query returns 2 (head:true => data null)
    { data: null, count: 0, error: null }, // completed query returns 0
    { data: null, count: 1, error: null }, // blocked query returns 1
  ]);

  const result = await getWorkAnalyticsTaskCounts({
    ownerUserId: "user-1",
    window,
    supabase: supabase as never,
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.createdCount, 2);
});

test("getWorkAnalyticsTaskCounts counts tasks completed inside the window", async () => {
  const supabase = createSupabaseMock([
    { data: null, count: 0, error: null },
    { data: null, count: 3, error: null },
    { data: null, count: 0, error: null },
  ]);

  const result = await getWorkAnalyticsTaskCounts({
    ownerUserId: "user-1",
    window,
    supabase: supabase as never,
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.completedCount, 3);
});

test("getWorkAnalyticsTaskCounts counts blocked tasks that are still open", async () => {
  const supabase = createSupabaseMock([
    { data: null, count: 0, error: null },
    { data: null, count: 0, error: null },
    { data: null, count: 2, error: null },
  ]);

  const result = await getWorkAnalyticsTaskCounts({
    ownerUserId: "user-1",
    window,
    supabase: supabase as never,
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.blockedCount, 2);
});

test("getWorkAnalyticsTaskCounts does NOT count tasks created before window start", async () => {
  const supabase = createSupabaseMock([
    { data: null, count: 0, error: null }, // no tasks created inside window
    { data: null, count: 0, error: null },
    { data: null, count: 0, error: null },
  ]);

  const result = await getWorkAnalyticsTaskCounts({
    ownerUserId: "user-1",
    window,
    supabase: supabase as never,
  });

  assert.equal(result.data?.createdCount, 0);
});

test("getWorkAnalyticsTaskCounts does NOT count tasks completed before window start", async () => {
  const supabase = createSupabaseMock([
    { data: null, count: 0, error: null },
    { data: null, count: 0, error: null }, // no tasks completed inside window
    { data: null, count: 0, error: null },
  ]);

  const result = await getWorkAnalyticsTaskCounts({
    ownerUserId: "user-1",
    window,
    supabase: supabase as never,
  });

  assert.equal(result.data?.completedCount, 0);
});

test("getWorkAnalyticsTaskCounts returns error message on failure (created query)", async () => {
  const supabase = createSupabaseMock([
    { data: null, count: null, error: { message: "DB connection failed" } },
  ]);

  const result = await getWorkAnalyticsTaskCounts({
    ownerUserId: "user-1",
    window,
    supabase: supabase as never,
  });

  assert.equal(result.data, null);
  assert.match(result.errorMessage ?? "", /DB connection failed/);
});

test("getWorkAnalyticsTaskCounts returns error message on failure (completed query)", async () => {
  const supabase = createSupabaseMock([
    { data: null, count: 4, error: null },
    { data: null, count: null, error: { message: "completed query failed" } },
  ]);

  const result = await getWorkAnalyticsTaskCounts({
    ownerUserId: "user-1",
    window,
    supabase: supabase as never,
  });

  assert.equal(result.data, null);
  assert.match(result.errorMessage ?? "", /completed query failed/);
});

test("getWorkAnalyticsTaskCounts returns error message on failure (blocked query)", async () => {
  const supabase = createSupabaseMock([
    { data: null, count: 1, error: null },
    { data: null, count: 2, error: null },
    { data: null, count: null, error: { message: "blocked query failed" } },
  ]);

  const result = await getWorkAnalyticsTaskCounts({
    ownerUserId: "user-1",
    window,
    supabase: supabase as never,
  });

  assert.equal(result.data, null);
  assert.match(result.errorMessage ?? "", /blocked query failed/);
});

test("getWorkAnalyticsTaskCounts handles null count as zero (fallback)", async () => {
  const supabase = createSupabaseMock([
    { data: null, count: null, error: null },
    { data: null, count: null, error: null },
    { data: null, count: null, error: null },
  ]);

  const result = await getWorkAnalyticsTaskCounts({
    ownerUserId: "user-1",
    window,
    supabase: supabase as never,
  });

  assert.equal(result.errorMessage, null);
  assert.deepEqual(result.data, { completedCount: 0, createdCount: 0, blockedCount: 0 });
});

// ——— REGRESSION: head:true semantics ———

test("regression: head:true – count is used even when data is null (created)", async () => {
  const supabase = createSupabaseMock([
    { data: null, count: 5, error: null },
    { data: null, count: 0, error: null },
    { data: null, count: 0, error: null },
  ]);

  const result = await getWorkAnalyticsTaskCounts({
    ownerUserId: "user-1",
    window,
    supabase: supabase as never,
  });

  // With real head:true, data is null; count holds the total.
  // If implementation uses data.length it would return 0.
  assert.equal(result.data?.createdCount, 5);
});

test("regression: head:true – count is used even when data is null (blocked)", async () => {
  const supabase = createSupabaseMock([
    { data: null, count: 0, error: null },
    { data: null, count: 0, error: null },
    { data: null, count: 7, error: null },
  ]);

  const result = await getWorkAnalyticsTaskCounts({
    ownerUserId: "user-1",
    window,
    supabase: supabase as never,
  });

  assert.equal(result.data?.blockedCount, 7);
});

test("regression: returns count not data.length when they disagree (completed)", async () => {
  const supabase = createSupabaseMock([
    { data: null, count: 0, error: null },
    // Intentionally provide mismatched data length vs count:
    // data has 1 row but count says 5; correct implementation must return 5.
    { data: [{ id: "task-1" }] as unknown[], count: 5, error: null },
    { data: null, count: 0, error: null },
  ]);

  const result = await getWorkAnalyticsTaskCounts({
    ownerUserId: "user-1",
    window,
    supabase: supabase as never,
  });

  assert.equal(result.data?.completedCount, 5);
});

test("regression: returns count not data.length when data has extra rows", async () => {
  const supabase = createSupabaseMock([
    // data has 3 rows but count is 0 – e.g., stale fixture mismatch; count wins.
    { data: [{ id: "a" }, { id: "b" }, { id: "c" }] as unknown[], count: 0, error: null },
    { data: null, count: 0, error: null },
    { data: null, count: 0, error: null },
  ]);

  const result = await getWorkAnalyticsTaskCounts({
    ownerUserId: "user-1",
    window,
    supabase: supabase as never,
  });

  assert.equal(result.data?.createdCount, 0);
});

test("regression: head:true with empty array data still returns count", async () => {
  const supabase = createSupabaseMock([
    { data: [], count: 9, error: null },
    { data: [], count: 0, error: null },
    { data: [], count: 0, error: null },
  ]);

  const result = await getWorkAnalyticsTaskCounts({
    ownerUserId: "user-1",
    window,
    supabase: supabase as never,
  });

  // Empty array length is 0 but count is 9 – correct is 9
  assert.equal(result.data?.createdCount, 9);
});

test("EGA-805: completed-in-window count is the authoritative head count", async () => {
  const supabase = createSupabaseMock([{ data: null, count: 14, error: null }]);

  const result = await getCompletedTaskCountForWindow({
    ownerUserId: "user-1",
    window,
    supabase: supabase as never,
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data, 14);
});

test("EGA-805: completed-in-window count fails closed", async () => {
  const supabase = createSupabaseMock([
    { data: null, count: null, error: { message: "permission denied" } },
  ]);

  const result = await getCompletedTaskCountForWindow({
    ownerUserId: "user-1",
    window,
    supabase: supabase as never,
  });

  assert.equal(result.data, null);
  assert.match(result.errorMessage ?? "", /permission denied/);
});

test("work analytics sessions fall back when the areas relation is missing", async () => {
  const supabase = createSupabaseMock([
    {
      data: null,
      count: null,
      error: {
        code: "PGRST200",
        message:
          "Could not find a relationship between 'projects' and 'areas' in the schema cache",
      },
    },
    {
      data: [
        {
          task_id: "task-1",
          started_at: "2026-04-20T09:00:00.000Z",
          ended_at: "2026-04-20T09:30:00.000Z",
          duration_seconds: 1800,
          tasks: { id: "task-1", title: "Plan", projects: { id: "project-1", name: "Work" } },
        },
      ],
      count: null,
      error: null,
    },
  ]);

  const result = await getWorkAnalyticsSessionsForWindow({
    ownerUserId: "user-1",
    window,
    supabase: supabase as never,
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.length, 1);
  assert.equal(supabase.selects.length, 2);
  assert.match(supabase.selects[0] ?? "", /areas\(id, name\)/);
  assert.doesNotMatch(supabase.selects[1] ?? "", /areas/);
});

test("work analytics sessions do not hide unrelated query failures", async () => {
  const supabase = createSupabaseMock([
    {
      data: null,
      count: null,
      error: { code: "42501", message: "permission denied for table task_sessions" },
    },
  ]);

  const result = await getWorkAnalyticsSessionsForWindow({
    ownerUserId: "user-1",
    window,
    supabase: supabase as never,
  });

  assert.equal(result.data, null);
  assert.match(result.errorMessage ?? "", /permission denied/);
  assert.equal(supabase.selects.length, 1);
});
