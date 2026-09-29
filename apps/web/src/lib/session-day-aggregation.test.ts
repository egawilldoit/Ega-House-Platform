import assert from "node:assert/strict";
import test from "node:test";

import { getLocalDayWindow } from "@ega/domain";

import {
  aggregateSessionEvidenceByLocalDay,
  buildLocalDateSeries,
} from "./session-day-aggregation";

function window(
  startDate: string,
  endDate: string,
  timezone: string,
) {
  const startWindow = getLocalDayWindow(timezone, startDate);
  const endWindow = getLocalDayWindow(timezone, endDate);
  return {
    startDate,
    endDate,
    startIso: startWindow.startUtcIso,
    endExclusiveIso: endWindow.endUtcIso,
    timezone,
  };
}

test("builds a consecutive local date series including zero-activity dates", () => {
  assert.deepEqual(buildLocalDateSeries("2026-09-21", "2026-09-23"), [
    "2026-09-21",
    "2026-09-22",
    "2026-09-23",
  ]);
  assert.deepEqual(buildLocalDateSeries("2026-02-28", "2026-03-01"), [
    "2026-02-28",
    "2026-03-01",
  ]);
  assert.deepEqual(buildLocalDateSeries("2024-02-28", "2024-03-01"), [
    "2024-02-28",
    "2024-02-29",
    "2024-03-01",
  ]);
  assert.deepEqual(buildLocalDateSeries("2026-09-23", "2026-09-21"), []);
});

test("aggregates tracked seconds and session counts per local day", () => {
  const evidence = aggregateSessionEvidenceByLocalDay(
    [
      { started_at: "2026-09-21T01:00:00.000Z", ended_at: "2026-09-21T02:00:00.000Z" },
      { started_at: "2026-09-21T03:00:00.000Z", ended_at: "2026-09-21T03:30:00.000Z" },
      { started_at: "2026-09-22T01:00:00.000Z", ended_at: "2026-09-22T02:00:00.000Z" },
    ],
    window("2026-09-21", "2026-09-22", "UTC"),
    "2026-09-22T03:00:00.000Z",
  );
  assert.deepEqual(evidence, [
    { date: "2026-09-21", trackedSeconds: 5400, sessionCount: 2 },
    { date: "2026-09-22", trackedSeconds: 3600, sessionCount: 1 },
  ]);
});

test("splits a closed session across local midnight without double-counting", () => {
  const evidence = aggregateSessionEvidenceByLocalDay(
    [{ started_at: "2026-09-21T23:30:00.000Z", ended_at: "2026-09-22T00:30:00.000Z" }],
    window("2026-09-21", "2026-09-22", "UTC"),
    "2026-09-22T01:00:00.000Z",
  );
  assert.deepEqual(evidence, [
    { date: "2026-09-21", trackedSeconds: 1800, sessionCount: 1 },
    { date: "2026-09-22", trackedSeconds: 1800, sessionCount: 1 },
  ]);
});

test("open session is clipped at the query now", () => {
  const evidence = aggregateSessionEvidenceByLocalDay(
    [{ started_at: "2026-09-22T00:30:00.000Z", ended_at: null }],
    window("2026-09-22", "2026-09-22", "UTC"),
    "2026-09-22T01:00:00.000Z",
  );
  assert.deepEqual(evidence, [{ date: "2026-09-22", trackedSeconds: 1800, sessionCount: 1 }]);
});

test("stale multi-day open session contributes to the current local day only", () => {
  const evidence = aggregateSessionEvidenceByLocalDay(
    [{ started_at: "2026-09-19T12:00:00.000Z", ended_at: null }],
    window("2026-09-19", "2026-09-22", "UTC"),
    "2026-09-22T12:00:00.000Z",
  );
  assert.deepEqual(evidence, [
    { date: "2026-09-19", trackedSeconds: 0, sessionCount: 0 },
    { date: "2026-09-20", trackedSeconds: 0, sessionCount: 0 },
    { date: "2026-09-21", trackedSeconds: 0, sessionCount: 0 },
    { date: "2026-09-22", trackedSeconds: 12 * 3600, sessionCount: 1 },
  ]);
});

test("timezone-aware: session near Asia/Tokyo midnight buckets to the correct local date", () => {
  const evidence = aggregateSessionEvidenceByLocalDay(
    [{ started_at: "2026-09-26T15:30:00.000Z", ended_at: "2026-09-26T16:00:00.000Z" }],
    window("2026-09-26", "2026-09-27", "Asia/Tokyo"),
    "2026-09-27T12:00:00.000Z",
  );
  assert.deepEqual(evidence, [
    { date: "2026-09-26", trackedSeconds: 0, sessionCount: 0 },
    { date: "2026-09-27", trackedSeconds: 1800, sessionCount: 1 },
  ]);
});

test("timezone-aware: DST fall-back 25-hour day in New York aggregates fully", () => {
  const evidence = aggregateSessionEvidenceByLocalDay(
    [{ started_at: "2026-11-01T04:30:00.000Z", ended_at: "2026-11-01T05:30:00.000Z" }],
    window("2026-11-01", "2026-11-01", "America/New_York"),
    "2026-11-01T12:00:00.000Z",
  );
  assert.deepEqual(evidence, [{ date: "2026-11-01", trackedSeconds: 3600, sessionCount: 1 }]);
});

test("malformed sessions are skipped without breaking the series", () => {
  const evidence = aggregateSessionEvidenceByLocalDay(
    [
      { started_at: "not-a-date", ended_at: "2026-09-21T02:00:00.000Z" },
      { started_at: "2026-09-21T03:00:00.000Z", ended_at: "2026-09-21T02:00:00.000Z" },
      { started_at: "2026-09-21T01:00:00.000Z", ended_at: "2026-09-21T02:00:00.000Z" },
    ],
    window("2026-09-21", "2026-09-21", "UTC"),
    "2026-09-21T03:00:00.000Z",
  );
  assert.deepEqual(evidence, [{ date: "2026-09-21", trackedSeconds: 3600, sessionCount: 1 }]);
});
