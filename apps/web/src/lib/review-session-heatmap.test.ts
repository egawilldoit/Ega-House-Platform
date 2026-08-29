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
  // Session from 23:30 JST 01-16 (=14:30Z 01-16) to 00:30 JST 01-17 (=15:30Z 01-16) crosses local midnight
  // Should split 30 min to 01-16, 30 min to 01-17
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

// ---------------------------------------------------------------------------
// Historical heatmap binding: selected week + canonical timezone → exact historical window → heatmap
// Covers B: week 8 weeks ago not current period, Tokyo, New York, DST
// ---------------------------------------------------------------------------

test("historical heatmap: 8 weeks ago window != current 28-day window (not current recent period)", () => {
  // Now is 2026-04-16, selected historical week 8 weeks ago is 2026-02-16 (Mon)
  const nowIso = "2026-04-16T12:00:00.000Z";
  const tz = "UTC";
  // Historical week Mon 2026-02-16 - Sun 2026-02-22
  const historicalWeekWindow = getDailyTrackedWindow(7, "2026-02-22", tz);
  // Default current recent 28-day window ending 2026-04-16 would be 2026-03-20 to 2026-04-16
  const currentWindow = getDailyTrackedWindow(28, "2026-04-16", tz);
  assert.notEqual(historicalWeekWindow.startIso, currentWindow.startIso);
  assert.notEqual(historicalWeekWindow.endExclusiveIso, currentWindow.endExclusiveIso);
  // Session inside historical week (2026-02-18) must count for historical, not current
  const session = [{ started_at: "2026-02-18T10:00:00.000Z", ended_at: "2026-02-18T11:00:00.000Z" }];
  const historicalData = aggregateDailyTrackedSeconds(session, historicalWeekWindow, nowIso);
  const currentData = aggregateDailyTrackedSeconds(session, currentWindow, nowIso);
  assert.equal(historicalData.find((d) => d.date === "2026-02-18")?.trackedSeconds, 3600);
  assert.equal(currentData.find((d) => d.date === "2026-02-18"), undefined);
  assert.ok(currentData.every((d) => d.trackedSeconds === 0 || d.date > "2026-03-19"));
});

test("historical heatmap Tokyo: 8 weeks ago week shows Tokyo local dates not UTC current", () => {
  const tz = "Asia/Tokyo";
  // Selected historical week 2026-02-16 Mon JST: week 2026-02-16-22 local, UTC window Sun 02-15 15:00Z -> Sun 02-22 15:00Z
  const historicalWeeklyWindow = getDailyTrackedWindow(7, "2026-02-22", tz);
  assert.equal(historicalWeeklyWindow.startIso, "2026-02-15T15:00:00.000Z");
  assert.equal(historicalWeeklyWindow.endExclusiveIso, "2026-02-22T15:00:00.000Z");
  // Session at 2026-02-18 00:30 JST = 2026-02-17T15:30Z should bucket to 02-18 Tokyo local
  const session = [{ started_at: "2026-02-17T15:30:00.000Z", ended_at: "2026-02-17T16:30:00.000Z" }];
  const data = aggregateDailyTrackedSeconds(session, historicalWeeklyWindow, "2026-04-16T12:00:00.000Z");
  assert.equal(data.find((d) => d.date === "2026-02-18")?.trackedSeconds, 3600);
  // Same session under UTC window for same dates would bucket to 02-17 UTC, not 02-18
  const utcWindow = getDailyTrackedWindow(7, "2026-02-22", "UTC");
  const utcData = aggregateDailyTrackedSeconds(session, utcWindow, "2026-04-16T12:00:00.000Z");
  assert.equal(utcData.find((d) => d.date === "2026-02-17")?.trackedSeconds, 3600);
  assert.equal(utcData.find((d) => d.date === "2026-02-18")?.trackedSeconds ?? 0, 0);
});

test("historical heatmap New York: selected historical week 8 weeks ago respects EST offset", () => {
  const tz = "America/New_York";
  // Week Mon 2026-02-16 EST (UTC-5): start 2026-02-16T05:00Z, end 2026-02-23T05:00Z (next Mon)
  const historicalWeeklyWindow = getDailyTrackedWindow(7, "2026-02-22", tz);
  assert.equal(historicalWeeklyWindow.startIso, "2026-02-16T05:00:00.000Z");
  assert.equal(historicalWeeklyWindow.endExclusiveIso, "2026-02-23T05:00:00.000Z");
  // Session at 2026-02-18 23:30 EST = 2026-02-19T04:30Z should bucket to 02-18 local, not 02-19 UTC
  const session = [{ started_at: "2026-02-19T04:30:00.000Z", ended_at: "2026-02-19T05:30:00.000Z" }];
  const data = aggregateDailyTrackedSeconds(session, historicalWeeklyWindow, "2026-04-16T12:00:00.000Z");
  // Only 30m before window next-day split counted for 02-18, remaining 30m for 02-19
  const feb18 = data.find((d) => d.date === "2026-02-18")?.trackedSeconds ?? 0;
  const feb19 = data.find((d) => d.date === "2026-02-19")?.trackedSeconds ?? 0;
  assert.equal(feb18, 1800);
  assert.equal(feb19, 1800);
});

test("historical heatmap DST: spring forward New York historical week spanning DST still correct", () => {
  const tz = "America/New_York";
  // Historical week spanning DST spring 2026-03-02 to 2026-03-08 (DST Sun Mar 8)
  const w = getDailyTrackedWindow(7, "2026-03-08", tz);
  // Week start Mon 03-02 05:00Z, end Mon 03-09 04:00Z (23h Sunday)
  assert.equal(w.startIso, "2026-03-02T05:00:00.000Z");
  assert.equal(w.endExclusiveIso, "2026-03-09T04:00:00.000Z");
  const durationHours = (new Date(w.endExclusiveIso).getTime() - new Date(w.startIso).getTime()) / 3600000;
  assert.equal(durationHours, 167);
  // Session on DST Sunday 00:30 EST = 05:30Z Mar 8 should count for Mar 8 local
  const session = [{ started_at: "2026-03-08T05:30:00.000Z", ended_at: "2026-03-08T06:00:00.000Z" }];
  const data = aggregateDailyTrackedSeconds(session, w, "2026-04-16T12:00:00.000Z");
  assert.equal(data.find((d) => d.date === "2026-03-08")?.trackedSeconds, 1800);
});

test("historical heatmap DST: fall back New York historical week spanning DST 25h Sunday", () => {
  const tz = "America/New_York";
  const w = getDailyTrackedWindow(7, "2026-11-01", tz);
  // Week Mon 2026-10-26 to Sun 2026-11-01 includes fall back Nov 1 (25h)
  assert.equal(w.startIso, "2026-10-26T04:00:00.000Z");
  assert.equal(w.endExclusiveIso, "2026-11-02T05:00:00.000Z");
  const durationHours = (new Date(w.endExclusiveIso).getTime() - new Date(w.startIso).getTime()) / 3600000;
  assert.equal(durationHours, 169); // 7 days +1h fall back in that week
  const session = [{ started_at: "2026-11-01T04:30:00.000Z", ended_at: "2026-11-01T05:30:00.000Z" }];
  const data = aggregateDailyTrackedSeconds(session, w, "2026-11-02T06:00:00.000Z");
  assert.equal(data.find((d) => d.date === "2026-11-01")?.trackedSeconds, 3600);
});
