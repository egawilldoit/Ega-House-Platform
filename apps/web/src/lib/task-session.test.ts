import assert from "node:assert/strict";
import test from "node:test";

import { formatDurationLabel as formatCanonicalDurationLabel } from "@ega/application/shared/duration";
import {
  formatDurationLabel,
  getSessionDurationWithinWindowSeconds,
  getTaskSessionDurationSeconds,
  getTaskSessionSummaryMap,
} from "./task-session";

test("uses the canonical application duration formatter", () => {
  assert.strictEqual(formatDurationLabel, formatCanonicalDurationLabel);
  assert.equal(formatDurationLabel(3661), "1h 1m 1s");
});

test("prefers timestamp-derived duration for completed sessions", () => {
  const durationSeconds = getTaskSessionDurationSeconds(
    {
      task_id: "task-1",
      started_at: "2026-04-16T09:00:00.000Z",
      ended_at: "2026-04-16T10:00:00.000Z",
      duration_seconds: 120,
    },
    "2026-04-16T11:00:00.000Z",
  );

  assert.equal(durationSeconds, 3600);
});

test("completed session duration stays fixed when recomputed at a later now", () => {
  const firstDuration = getTaskSessionDurationSeconds(
    {
      task_id: "task-1",
      started_at: "2026-04-16T09:00:00.000Z",
      ended_at: "2026-04-16T10:00:00.000Z",
      duration_seconds: null,
    },
    "2026-04-16T10:30:00.000Z",
  );

  const laterDuration = getTaskSessionDurationSeconds(
    {
      task_id: "task-1",
      started_at: "2026-04-16T09:00:00.000Z",
      ended_at: "2026-04-16T10:00:00.000Z",
      duration_seconds: null,
    },
    "2026-04-16T13:30:00.000Z",
  );

  assert.equal(firstDuration, 3600);
  assert.equal(laterDuration, 3600);
});

test("active session duration increases when recomputed at a later now", () => {
  const firstDuration = getTaskSessionDurationSeconds(
    {
      task_id: "task-1",
      started_at: "2026-04-16T09:00:00.000Z",
      ended_at: null,
      duration_seconds: null,
    },
    "2026-04-16T10:00:00.000Z",
  );

  const laterDuration = getTaskSessionDurationSeconds(
    {
      task_id: "task-1",
      started_at: "2026-04-16T09:00:00.000Z",
      ended_at: null,
      duration_seconds: null,
    },
    "2026-04-16T10:15:00.000Z",
  );

  assert.equal(firstDuration, 3600);
  assert.equal(laterDuration, 4500);
});

test("computes overlap for an open session within a day window", () => {
  const seconds = getSessionDurationWithinWindowSeconds(
    {
      task_id: "task-1",
      started_at: "2026-04-16T01:00:00.000Z",
      ended_at: null,
      duration_seconds: null,
    },
    {
      startIso: "2026-04-16T00:00:00.000Z",
      endIso: "2026-04-16T03:00:00.000Z",
    },
    "2026-04-16T03:00:00.000Z",
  );

  assert.equal(seconds, 7200);
});

test("clips session duration to the selected window", () => {
  const seconds = getSessionDurationWithinWindowSeconds(
    {
      task_id: "task-1",
      started_at: "2026-04-15T23:30:00.000Z",
      ended_at: "2026-04-16T00:30:00.000Z",
      duration_seconds: null,
    },
    {
      startIso: "2026-04-16T00:00:00.000Z",
      endIso: "2026-04-16T23:59:59.000Z",
    },
  );

  assert.equal(seconds, 1800);
});

test("returns zero when session does not overlap the selected window", () => {
  const seconds = getSessionDurationWithinWindowSeconds(
    {
      task_id: "task-1",
      started_at: "2026-04-15T09:00:00.000Z",
      ended_at: "2026-04-15T09:30:00.000Z",
      duration_seconds: null,
    },
    {
      startIso: "2026-04-16T00:00:00.000Z",
      endIso: "2026-04-16T23:59:59.000Z",
    },
  );

  assert.equal(seconds, 0);
});


function sessionQueryHarness(rows: Array<{ task_id: string; started_at: string; ended_at: string | null; duration_seconds: number | null }>) {
  const inChunks: string[][] = [];
  const ranges: Array<[number, number]> = [];

  const client = {
    from() {
      let chunk: string[] = [];
      const builder = {
        select() {
          return builder;
        },
        in(_column: string, values: string[]) {
          chunk = values;
          inChunks.push(values);
          return builder;
        },
        order() {
          return builder;
        },
        range(from: number, to: number) {
          ranges.push([from, to]);
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        },
      };
      return builder;
    },
  };

  return { client, inChunks, ranges };
}

test("session summary chunks task ids to keep the query bounded", async () => {
  const taskIds = Array.from({ length: 250 }, (_, index) => `task-${index}`);
  const harness = sessionQueryHarness([]);

  await getTaskSessionSummaryMap(
    harness.client as never,
    taskIds,
    { startIso: "2026-12-07T00:00:00.000Z", endIso: "2026-12-14T00:00:00.000Z" },
    "2026-12-08T00:00:00.000Z",
  );

  assert.deepEqual(harness.inChunks.map((chunk) => chunk.length), [200, 50]);
});

test("session summary pages past the implicit row cap", async () => {
  const rows = Array.from({ length: 1001 }, (_, index) => ({
    task_id: "task-1",
    started_at: `2026-12-07T10:00:${String(index % 60).padStart(2, "0")}.000Z`,
    ended_at: `2026-12-07T10:01:${String(index % 60).padStart(2, "0")}.000Z`,
    duration_seconds: 60,
  }));
  const harness = sessionQueryHarness(rows);

  const result = await getTaskSessionSummaryMap(
    harness.client as never,
    ["task-1"],
    { startIso: "2026-12-07T00:00:00.000Z", endIso: "2026-12-14T00:00:00.000Z" },
    "2026-12-08T00:00:00.000Z",
  );

  assert.equal(result.sessions.length, 1001);
  assert.deepEqual(harness.ranges, [
    [0, 999],
    [1000, 1999],
  ]);
});
