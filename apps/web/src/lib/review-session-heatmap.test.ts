import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateDailyTrackedSeconds,
  buildUtcDateSeries,
  getDailyTrackedWindow,
} from "./review-session-heatmap";

test("builds a stable UTC date series for the selected window", () => {
  assert.deepEqual(buildUtcDateSeries("2026-04-14", "2026-04-17"), [
    "2026-04-14",
    "2026-04-15",
    "2026-04-16",
    "2026-04-17",
  ]);
});

test("splits tracked seconds across UTC days and includes zero-value dates", () => {
  const window = getDailyTrackedWindow(3, "2026-04-16");
  const data = aggregateDailyTrackedSeconds(
    [
      {
        started_at: "2026-04-14T23:30:00.000Z",
        ended_at: "2026-04-15T00:30:00.000Z",
      },
      {
        started_at: "2026-04-16T00:00:00.000Z",
        ended_at: "2026-04-16T00:45:00.000Z",
      },
    ],
    window,
    "2026-04-16T01:00:00.000Z",
  );

  assert.deepEqual(data, [
    { date: "2026-04-14", trackedSeconds: 1800 },
    { date: "2026-04-15", trackedSeconds: 1800 },
    { date: "2026-04-16", trackedSeconds: 2700 },
  ]);
});

test("clips an open session at nowIso for partial current-day totals", () => {
  const window = getDailyTrackedWindow(1, "2026-04-16");
  const data = aggregateDailyTrackedSeconds(
    [
      {
        started_at: "2026-04-16T00:30:00.000Z",
        ended_at: null,
      },
    ],
    window,
    "2026-04-16T01:00:00.000Z",
  );

  assert.deepEqual(data, [{ date: "2026-04-16", trackedSeconds: 1800 }]);
});

test("splits sessions that span multiple UTC days and clips to the selected window", () => {
  const window = getDailyTrackedWindow(3, "2026-04-16");
  const data = aggregateDailyTrackedSeconds(
    [
      {
        started_at: "2026-04-13T23:30:00.000Z",
        ended_at: "2026-04-16T01:15:00.000Z",
      },
    ],
    window,
    "2026-04-16T03:00:00.000Z",
  );

  assert.deepEqual(data, [
    { date: "2026-04-14", trackedSeconds: 86400 },
    { date: "2026-04-15", trackedSeconds: 86400 },
    { date: "2026-04-16", trackedSeconds: 4500 },
  ]);
});

test("returns all zero values when no sessions overlap the selected window", () => {
  const window = getDailyTrackedWindow(2, "2026-04-16");
  const data = aggregateDailyTrackedSeconds(
    [
      {
        started_at: "2026-04-10T01:00:00.000Z",
        ended_at: "2026-04-10T02:00:00.000Z",
      },
    ],
    window,
    "2026-04-16T03:00:00.000Z",
  );

  assert.deepEqual(data, [
    { date: "2026-04-15", trackedSeconds: 0 },
    { date: "2026-04-16", trackedSeconds: 0 },
  ]);
});

test("timezone-aware: Asia/Tokyo 00:30 local splits to correct local date (UTC 15:30Z -> 01-16 JST)", () => {
  // User in Asia/Tokyo (UTC+9). 2026-01-15T15:00Z is 2026-01-16 00:00 JST.
  // Window for Tokyo today 2026-01-16 should be 2026-01-15T15:00:00.000Z -> 2026-01-16T15:00:00.000Z
  const window = getDailyTrackedWindow(1, "2026-01-16", "Asia/Tokyo");
  assert.equal(window.startIso, "2026-01-15T15:00:00.000Z");
  assert.equal(window.endExclusiveIso, "2026-01-16T15:00:00.000Z");
  // Session at 2026-01-16 00:30 JST = 2026-01-15T15:30:00.000Z should count for 01-16 local
  const data = aggregateDailyTrackedSeconds(
    [{ started_at: "2026-01-15T15:30:00.000Z", ended_at: "2026-01-15T16:00:00.000Z" }],
    window,
    "2026-01-16T01:00:00.000Z",
  );
  assert.deepEqual(data, [{ date: "2026-01-16", trackedSeconds: 1800 }]);
  // Same session under UTC window for 2026-01-15 would incorrectly bucket to 01-15
  const utcWindow = getDailyTrackedWindow(1, "2026-01-15", "UTC");
  const utcData = aggregateDailyTrackedSeconds(
    [{ started_at: "2026-01-15T15:30:00.000Z", ended_at: "2026-01-15T16:00:00.000Z" }],
    utcWindow,
    "2026-01-16T01:00:00.000Z",
  );
  assert.deepEqual(utcData, [{ date: "2026-01-15", trackedSeconds: 1800 }]);
});

test("timezone-aware: New York 23:30 local on 01-15 (04:30 next day UTC) buckets to 01-15 local", () => {
  const window = getDailyTrackedWindow(1, "2026-01-15", "America/New_York");
  // 2026-01-15 00:00 EST = 05:00Z, next day 00:00 EST = 2026-01-16T05:00:00.000Z
  assert.equal(window.startIso, "2026-01-15T05:00:00.000Z");
  assert.equal(window.endExclusiveIso, "2026-01-16T05:00:00.000Z");
  // Session at 23:30 EST on 01-15 = 2026-01-16T04:30:00.000Z
  const data = aggregateDailyTrackedSeconds(
    [{ started_at: "2026-01-16T04:30:00.000Z", ended_at: "2026-01-16T05:30:00.000Z" }],
    window,
    "2026-01-16T06:00:00.000Z",
  );
  // Only 30 minutes before window end should count, remaining 30 minutes is next day 01-16 local
  assert.deepEqual(data, [{ date: "2026-01-15", trackedSeconds: 1800 }]);
});

test("timezone-aware: session crossing local midnight splits correctly", () => {
  // Tokyo day 01-16 window: 15:00Z 01-15 -> 15:00Z 01-16; day 01-16 and 01-17 window for 2 days
  const window = getDailyTrackedWindow(2, "2026-01-16", "Asia/Tokyo");
  // Session from 23:30 JST 01-16 (=14:30Z 01-16) to 00:30 JST 01-17 (=15:30Z 01-16) crosses local midnight
  // Should split 30 min to 01-16, 30 min to next window? But our 2-day window is 01-15..01-16, next day not included.
  // Let's use window 01-16..01-17 to see split
  const window2 = getDailyTrackedWindow(2, "2026-01-17", "Asia/Tokyo");
  const data = aggregateDailyTrackedSeconds(
    [{ started_at: "2026-01-16T14:30:00.000Z", ended_at: "2026-01-16T15:30:00.000Z" }],
    window2,
    "2026-01-17T16:00:00.000Z",
  );
  assert.deepEqual(data, [
    { date: "2026-01-16", trackedSeconds: 1800 },
    { date: "2026-01-17", trackedSeconds: 1800 },
  ]);
});

test("timezone-aware: DST spring 23h day in New York", () => {
  const w = getDailyTrackedWindow(1, "2026-03-08", "America/New_York");
  // 2026-03-08 is DST spring (23h): 05:00Z -> 04:00Z next day? Check duration
  assert.equal(w.startIso, "2026-03-08T05:00:00.000Z");
  assert.equal(w.endExclusiveIso, "2026-03-09T04:00:00.000Z");
  const durationHours = (new Date(w.endExclusiveIso).getTime() - new Date(w.startIso).getTime()) / 3600000;
  assert.equal(durationHours, 23);
});

test("timezone-aware: DST fall 25h day in New York", () => {
  const w = getDailyTrackedWindow(1, "2026-11-01", "America/New_York");
  assert.equal(w.startIso, "2026-11-01T04:00:00.000Z");
  assert.equal(w.endExclusiveIso, "2026-11-02T05:00:00.000Z");
  const durationHours = (new Date(w.endExclusiveIso).getTime() - new Date(w.startIso).getTime()) / 3600000;
  assert.equal(durationHours, 25);
});

test("timezone-aware: historical Review week window reproducibility", () => {
  const tz = "Asia/Tokyo";
  const w1 = getDailyTrackedWindow(7, "2026-01-18", tz);
  const w2 = getDailyTrackedWindow(7, "2026-01-18", tz);
  assert.deepEqual(w1, w2);
});

test("heatmap day totals agree with canonical execution evidence total for same window", async () => {
  const { calculateExecutionEvidenceForWindow } = await import("@ega/application/shared/execution-evidence");
  const tz = "Asia/Tokyo";
  const window = getDailyTrackedWindow(2, "2026-01-17", tz);
  const sessions = [
    { task_id: "t1", started_at: "2026-01-16T14:30:00.000Z", ended_at: "2026-01-16T15:30:00.000Z", duration_seconds: 3600, tasks: null },
    { task_id: "t2", started_at: "2026-01-16T16:00:00.000Z", ended_at: "2026-01-16T16:45:00.000Z", duration_seconds: 2700, tasks: null },
  ];
  const heatmap = aggregateDailyTrackedSeconds(sessions, window, "2026-01-17T16:00:00.000Z");
  const totalHeatmap = heatmap.reduce((sum, d) => sum + d.trackedSeconds, 0);
  const evidence = calculateExecutionEvidenceForWindow(sessions, { startIso: window.startIso, endIso: window.endExclusiveIso }, { nowIso: "2026-01-17T16:00:00.000Z" });
  assert.equal(totalHeatmap, evidence.totalTrackedSeconds);
});

test("isValidWindowIso hardening: getRecentDailyTrackedTime rejects invalid window", async () => {
  const fakeSupabase: unknown = {
    from() {
      return {
        select() { return this; },
        lt() { return this; },
        or() { return this; },
        eq() { return this; },
        then() {},
      };
    },
  };
  const { getRecentDailyTrackedTime } = await import("./review-session-heatmap");
  await assert.rejects(() =>
    getRecentDailyTrackedTime(fakeSupabase as never, {
      window: { startIso: "bad',injection", endExclusiveIso: "2026-01-16T15:00:00.000Z", startDate: "2026-01-16", endDate: "2026-01-16", timezone: "UTC" },
    }),
  );
});
