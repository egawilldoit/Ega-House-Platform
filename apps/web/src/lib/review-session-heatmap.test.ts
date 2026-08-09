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
