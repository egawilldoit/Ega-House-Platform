import assert from "node:assert/strict";
import test from "node:test";
import { vi } from "vitest";

type QueryResult = {
  data: unknown;
  error: { message: string } | null;
};

const fromMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: fromMock,
  })),
}));

const { buildWorkActivityReadModel } = await import("./work-activity-read-model");

function makeChain(result: QueryResult) {
  const chain: Record<string, unknown> = {
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
    in: () => chain,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (value: QueryResult) => void) => resolve(result),
  };
  return chain;
}

function setupMock(results: Map<string, QueryResult>) {
  fromMock.mockImplementation((table: string) => ({
    select: () => makeChain(results.get(table) ?? { data: null, error: null }),
  }));
}

test("buildWorkActivityReadModel resolves timezone and builds a 365-day calendar", async () => {
  setupMock(
    new Map([
      ["user_time_context", { data: { iana_timezone: "Asia/Tokyo" }, error: null }],
      ["task_sessions", { data: [{ task_id: "t1", started_at: "2026-09-26T15:30:00Z", ended_at: "2026-09-26T16:00:00Z" }], error: null }],
      ["task_status_events", { data: [{ occurred_at: "2026-09-27T02:00:00Z", task_id: "t2" }], error: null }],
    ]),
  );

  const result = await buildWorkActivityReadModel({
    ownerUserId: "user-1",
    now: new Date("2026-09-27T12:00:00.000Z"),
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.timezone, "Asia/Tokyo");
  const calendar = result.data?.calendar;
  assert.equal(calendar?.days.length, 365);
  assert.equal(calendar?.startDate, "2025-09-28");
  assert.equal(calendar?.endDate, "2026-09-27");

  // Session 2026-09-26T15:30Z = 2026-09-27 00:30 JST → buckets to 2026-09-27.
  const sessionDay = calendar?.days.find((d) => d.date === "2026-09-27");
  assert.equal(sessionDay?.trackedSeconds, 1800);
  assert.equal(sessionDay?.sessionCount, 1);

  // Completion 2026-09-27T02:00Z = 2026-09-27 11:00 JST → buckets to 2026-09-27.
  assert.equal(sessionDay?.completedTaskCount, 1);
  assert.equal(sessionDay?.isActive, true);
  assert.equal(calendar?.activeDayCount, 1);
  assert.equal(calendar?.totalCompletedTasks, 1);
});

test("buildWorkActivityReadModel falls back to UTC when no timezone is stored", async () => {
  setupMock(
    new Map([
      ["user_time_context", { data: null, error: null }],
      ["task_sessions", { data: [], error: null }],
      ["task_status_events", { data: [], error: null }],
    ]),
  );

  const result = await buildWorkActivityReadModel({
    ownerUserId: "user-1",
    now: new Date("2026-09-27T12:00:00.000Z"),
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.timezone, "UTC");
  assert.equal(result.data?.calendar.days.length, 365);
  assert.equal(result.data?.calendar.activeDayCount, 0);
});

test("buildWorkActivityReadModel returns error when timezone cannot be loaded", async () => {
  setupMock(
    new Map([
      ["user_time_context", { data: null, error: { message: "boom" } }],
    ]),
  );

  const result = await buildWorkActivityReadModel({ ownerUserId: "user-1" });
  assert.equal(result.data, null);
  assert.match(result.errorMessage ?? "", /timezone/);
});

test("buildWorkActivityReadModel returns error when sessions fail to load", async () => {
  setupMock(
    new Map([
      ["user_time_context", { data: { iana_timezone: "UTC" }, error: null }],
      ["task_sessions", { data: null, error: { message: "boom" } }],
    ]),
  );

  const result = await buildWorkActivityReadModel({ ownerUserId: "user-1" });
  assert.equal(result.data, null);
  assert.match(result.errorMessage ?? "", /Failed to load work activity sessions/);
});

test("buildWorkActivityReadModel returns error when completions fail to load", async () => {
  setupMock(
    new Map([
      ["user_time_context", { data: { iana_timezone: "UTC" }, error: null }],
      ["task_sessions", { data: [], error: null }],
      ["task_status_events", { data: null, error: { message: "boom" } }],
    ]),
  );

  const result = await buildWorkActivityReadModel({ ownerUserId: "user-1" });
  assert.equal(result.data, null);
  assert.match(result.errorMessage ?? "", /Failed to load work activity completions/);
});
