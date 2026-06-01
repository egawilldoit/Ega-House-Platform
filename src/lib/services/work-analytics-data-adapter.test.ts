import assert from "node:assert/strict";
import test from "node:test";

import { getWorkAnalyticsTaskCounts } from "./work-analytics-data-adapter";

type QueryResult = {
  data: unknown[] | null;
  error: { message: string } | null;
};

/**
 * Creates a mock Supabase client that returns the given query results in order.
 * The mock handles the chained `.from().select().eq().gte().lt().or().is()` pattern
 * used by getWorkAnalyticsTaskCounts.
 *
 * Each element in queryResults corresponds to one awaited `select()` call.
 * The chain methods (eq, gte, lt, or, is) all return the same chain, and `await`
 * on the chain resolves to the next query result.
 */
function createSupabaseMock(queryResults: QueryResult[]) {
  let index = 0;

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
    from(_table: string) {
      return {
        select(_columns: string, _opts?: unknown) {
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
    { data: [], error: null }, // created
    { data: [], error: null }, // completed
    { data: [], error: null }, // blocked
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
    { data: [{ id: "task-1" }, { id: "task-2" }], error: null }, // created query returns 2
    { data: [], error: null }, // completed query returns 0
    { data: [{ id: "task-blocked" }], error: null }, // blocked query returns 1
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
    { data: [], error: null },
    { data: [{ id: "task-1" }, { id: "task-2" }, { id: "task-3" }], error: null },
    { data: [], error: null },
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
    { data: [], error: null },
    { data: [], error: null },
    { data: [{ id: "task-1" }, { id: "task-2" }], error: null },
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
    { data: [], error: null }, // no tasks created inside window
    { data: [], error: null },
    { data: [], error: null },
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
    { data: [], error: null },
    { data: [], error: null }, // no tasks completed inside window
    { data: [], error: null },
  ]);

  const result = await getWorkAnalyticsTaskCounts({
    ownerUserId: "user-1",
    window,
    supabase: supabase as never,
  });

  assert.equal(result.data?.completedCount, 0);
});

test("getWorkAnalyticsTaskCounts returns error message on failure", async () => {
  const supabase = createSupabaseMock([
    { data: null, error: { message: "DB connection failed" } },
  ]);

  const result = await getWorkAnalyticsTaskCounts({
    ownerUserId: "user-1",
    window,
    supabase: supabase as never,
  });

  assert.equal(result.data, null);
  assert.match(result.errorMessage ?? "", /DB connection failed/);
});
