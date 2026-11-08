import assert from "node:assert/strict";
import test from "node:test";

import { getCurrentLocalDayWindow } from "@ega/domain/time-context";

import { getTimerSummary } from "./timer-service";

type SummaryRow = {
  id: string;
  task_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  owner_user_id: string;
  tasks: { title: string } | null;
};

function makeRow(index: number, overrides: Partial<SummaryRow> = {}): SummaryRow {
  return {
    id: String(index).padStart(4, "0"),
    task_id: "task-1",
    started_at: "2026-08-10T10:00:00.000Z",
    ended_at: "2026-08-10T10:00:01.000Z",
    duration_seconds: 1,
    owner_user_id: "owner-a",
    tasks: { title: "Focus" },
    ...overrides,
  };
}

function createSummarySupabase(
  rows: SummaryRow[],
  options: { failOnCall?: number } = {},
) {
  let calls = 0;

  return {
    from(table: string) {
      assert.equal(table, "task_sessions");
      let owner: string | null = null;
      let afterId: string | null = null;
      let limit = 1000;

      const chain = {
        select() {
          return chain;
        },
        eq(column: string, value: string) {
          if (column === "owner_user_id") owner = value;
          return chain;
        },
        order() {
          return chain;
        },
        limit(value: number) {
          limit = value;
          return chain;
        },
        gt(column: string, value: string) {
          assert.equal(column, "id");
          afterId = value;
          return chain;
        },
        then<TResult>(
          onFulfilled?: ((value: { data: SummaryRow[] | null; error: { message: string } | null }) => TResult) | null,
          onRejected?: ((reason: unknown) => TResult) | null,
        ) {
          calls += 1;
          if (options.failOnCall !== undefined && calls >= options.failOnCall) {
            return Promise.resolve<TResult>(
              { data: null, error: { message: "page read failed" } } as never,
            ).then(onFulfilled as never, onRejected);
          }

          const filtered = rows.filter(
            (row) =>
              (owner === null || row.owner_user_id === owner) &&
              (afterId === null || row.id > afterId),
          );
          return Promise.resolve({ data: filtered.slice(0, limit), error: null }).then(
            onFulfilled,
            onRejected,
          );
        },
      };

      return chain;
    },
  };
}

const NOW = new Date("2026-08-10T12:00:00.000Z");

test("summary totals include all 501 sessions, not the old 150-row cap", async () => {
  const rows = Array.from({ length: 501 }, (_, index) => makeRow(index));
  const supabase = createSummarySupabase(rows);

  const result = await getTimerSummary({
    supabase: supabase as never,
    now: NOW,
    timezone: "UTC",
    ownerUserId: "owner-a",
  } as never);

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.trackedTotalSeconds, 501);
  assert.equal(result.data?.trackedTodaySeconds, 501);
  assert.equal(result.data?.sessionsTodayCount, 501);
});

test("summary totals include today sessions beyond 120 and midnight overlap", async () => {
  const todayRows = Array.from({ length: 151 }, (_, index) =>
    makeRow(index, {
      started_at: "2026-08-11T00:10:00.000Z",
      ended_at: "2026-08-11T00:10:01.000Z",
    }),
  );
  const crossing = makeRow(999, {
    id: "9999",
    started_at: "2026-08-10T23:30:00.000Z",
    ended_at: "2026-08-11T00:30:00.000Z",
    duration_seconds: 3600,
  });
  const foreign = makeRow(1000, {
    id: "10000",
    owner_user_id: "owner-b",
  });
  const supabase = createSummarySupabase([...todayRows, crossing, foreign]);

  const result = await getTimerSummary({
    supabase: supabase as never,
    now: new Date("2026-08-11T00:45:00.000Z"),
    timezone: "UTC",
    ownerUserId: "owner-a",
  } as never);

  assert.equal(result.errorMessage, null);
  // 151 one-second sessions + 30 minutes of the midnight-crossing session.
  assert.equal(result.data?.trackedTodaySeconds, 151 + 1800);
  assert.equal(result.data?.trackedTotalSeconds, 151 + 3600);
  assert.equal(result.data?.sessionsTodayCount, 152);
  assert.equal(result.data?.longestSessionSeconds, 3600);
});

test("summary fails instead of returning partial totals when a later page fails", async () => {
  const rows = Array.from({ length: 500 }, (_, index) => makeRow(index));
  const supabase = createSummarySupabase(rows, { failOnCall: 2 });

  const result = await getTimerSummary({
    supabase: supabase as never,
    now: NOW,
    timezone: "UTC",
    ownerUserId: "owner-a",
  } as never);

  assert.equal(result.data, null);
  assert.equal(result.errorMessage, "Could not load timer summary right now.");
});

test("summary keeps the canonical 25-hour day window across a DST fall-back", async () => {
  const window = getCurrentLocalDayWindow(
    "America/New_York",
    new Date("2026-11-01T12:00:00.000Z"),
  );
  assert.equal(window.durationHours, 25);
});
