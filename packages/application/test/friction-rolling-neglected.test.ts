import assert from "node:assert/strict";
import test from "node:test";

import { getRollingLocalWindow, getLocalDayWindow, getWeekWindow, getLocalDateInTimezone } from "@ega/domain/time-context";
import { FRICTION_NEGLECTED_GOAL_WINDOW_DAYS } from "@ega/domain/friction";
import { getNeglectedGoalSignals } from "../src/friction/neglected-goal";
import type { FrictionGoalRow } from "../src/friction/ports";
import type { ExecutionEvidenceSessionRow, ExecutionEvidenceWindow } from "../src/shared/execution-evidence";

// Fixed now for deterministic tests
const NOW = new Date("2026-04-22T12:00:00.000Z");

function goal(id: string): FrictionGoalRow {
  return { id, title: `Goal ${id}`, status: "active", updatedAt: "2026-04-01T00:00:00.000Z", projectId: "p1" };
}

function sess(over: Partial<ExecutionEvidenceSessionRow> & { task_id: string; started_at: string }): ExecutionEvidenceSessionRow {
  return {
    ended_at: new Date(new Date(over.started_at).getTime() + 60 * 60 * 1000).toISOString(),
    duration_seconds: null,
    tasks: null,
    ...over,
  } as ExecutionEvidenceSessionRow;
}

function daysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

test("rolling neglected: activity 8 days ago → not neglected", () => {
  const window = getRollingLocalWindow("UTC", NOW, FRICTION_NEGLECTED_GOAL_WINDOW_DAYS);
  const goals = [goal("g1")];
  const sessions: ExecutionEvidenceSessionRow[] = [
    sess({
      task_id: "t1",
      started_at: daysAgo(NOW, 8),
      tasks: { goals: { id: "g1", title: "Goal g1" }, goal_id: "g1" },
    }),
  ];
  const signals = getNeglectedGoalSignals(goals, sessions, window, { now: NOW });
  assert.equal(signals.length, 0, "8 days ago inside 14-day window should not be neglected");
});

test("rolling neglected: activity 13 days ago → not neglected", () => {
  const window = getRollingLocalWindow("UTC", NOW, FRICTION_NEGLECTED_GOAL_WINDOW_DAYS);
  const goals = [goal("g1")];
  const sessions: ExecutionEvidenceSessionRow[] = [
    sess({
      task_id: "t1",
      started_at: daysAgo(NOW, 13),
      tasks: { goals: { id: "g1", title: "Goal g1" }, goal_id: "g1" },
    }),
  ];
  const signals = getNeglectedGoalSignals(goals, sessions, window, { now: NOW });
  assert.equal(signals.length, 0);
});

test("rolling neglected: activity >=14 days → neglected according to exact threshold (outside window)", () => {
  const window = getRollingLocalWindow("UTC", NOW, FRICTION_NEGLECTED_GOAL_WINDOW_DAYS);
  // Activity just before window start should be neglected — session fully before window
  const beforeStartEnd = new Date(new Date(window.startIso).getTime() - 1000).toISOString();
  const beforeStart = new Date(new Date(beforeStartEnd).getTime() - 30 * 60 * 1000).toISOString();
  const goals = [goal("g1")];
  const sessionBefore = sess({
    task_id: "t1",
    started_at: beforeStart,
    ended_at: beforeStartEnd,
    tasks: { goals: { id: "g1", title: "Goal g1" }, goal_id: "g1" },
  });
  const neglected = getNeglectedGoalSignals(goals, [sessionBefore], window, { now: NOW });
  assert.equal(neglected.length, 1, "activity before 14-day window start should be neglected");

  // Activity just after start should NOT be neglected (inside window)
  const afterStart = new Date(new Date(window.startIso).getTime() + 1000).toISOString();
  const sessionAfter = sess({
    task_id: "t1",
    started_at: afterStart,
    ended_at: new Date(new Date(afterStart).getTime() + 30 * 60 * 1000).toISOString(),
    tasks: { goals: { id: "g1", title: "Goal g1" }, goal_id: "g1" },
  });
  const notNeglected = getNeglectedGoalSignals(goals, [sessionAfter], window, { now: NOW });
  assert.equal(notNeglected.length, 0, "activity just after window start should not be neglected");

  // Activity exactly 15 days ago (well before window) should be neglected
  const fifteenDays = sess({
    task_id: "t2",
    started_at: daysAgo(NOW, 15),
    tasks: { goals: { id: "g1", title: "Goal g1" }, goal_id: "g1" },
  });
  const neglected15 = getNeglectedGoalSignals(goals, [fifteenDays], window, { now: NOW });
  assert.equal(neglected15.length, 1);
});

test("rolling neglected: Monday boundary — week window would false-neglect but rolling does not", () => {
  // Now is Monday 2026-01-12 noon UTC; local date in UTC is Monday
  const mondayNow = new Date("2026-01-12T12:00:00.000Z");
  const rollingWindow = getRollingLocalWindow("UTC", mondayNow, 14);
  // Activity on Sunday 2026-01-11 (1 day ago) — outside week window (Mon 00:00 start) but inside 14-day
  const sundaySession = sess({
    task_id: "t1",
    started_at: "2026-01-11T10:00:00.000Z",
    tasks: { goals: { id: "g1", title: "G1" }, goal_id: "g1" },
  });
  const goals = [goal("g1")];
  const rollingSignals = getNeglectedGoalSignals(goals, [sundaySession], rollingWindow, { now: mondayNow });
  assert.equal(rollingSignals.length, 0, "Sunday activity should be inside 14-day rolling, not neglected");

  // Simulate old week window defect: Monday start to now
  const localDate = getLocalDateInTimezone(mondayNow, "UTC");
  const week = getWeekWindow("UTC", localDate);
  const weekWindow: ExecutionEvidenceWindow = { startIso: week.weekStartUtcIso, endIso: mondayNow.toISOString() };
  const weekSignals = getNeglectedGoalSignals(goals, [sundaySession], weekWindow, { now: mondayNow });
  assert.equal(weekSignals.length, 1, "week window incorrectly flags Sunday as neglected — proves defect");
});

test("rolling neglected: Tokyo timezone — local 14-day window correct", () => {
  // Now is 2026-01-15T15:00Z => 2026-01-16 00:00 Tokyo? Actually Tokyo UTC+9, midnight local 2026-01-15 is 2026-01-14T15:00Z
  // Use a Tokyo-local now: pick 2026-01-15T12:00 local Tokyo = 2026-01-15T03:00Z
  const tokyoNow = new Date("2026-01-15T03:00:00.000Z"); // 12:00 Tokyo 2026-01-15
  const rollingWindow = getRollingLocalWindow("Asia/Tokyo", tokyoNow, 14);
  // Activity 8 days ago in Tokyo local time: 2026-01-07 12:00 Tokyo = 2026-01-07T03:00Z
  const eightDaysAgoTokyo = sess({
    task_id: "t1",
    started_at: "2026-01-07T03:00:00.000Z",
    tasks: { goals: { id: "g1", title: "G1" }, goal_id: "g1" },
  });
  const goals = [goal("g1")];
  const notNeglected = getNeglectedGoalSignals(goals, [eightDaysAgoTokyo], rollingWindow, { now: tokyoNow });
  assert.equal(notNeglected.length, 0);

  // Activity 15 days ago Tokyo should be neglected (before window)
  const fifteenDaysAgoTokyo = sess({
    task_id: "t2",
    started_at: "2025-12-31T03:00:00.000Z", // 15 days before 2026-01-15
    tasks: { goals: { id: "g1", title: "G1" }, goal_id: "g1" },
  });
  const neglected = getNeglectedGoalSignals(goals, [fifteenDaysAgoTokyo], rollingWindow, { now: tokyoNow });
  assert.equal(neglected.length, 1);
});

test("rolling neglected: New York timezone — local 14-day window correct", () => {
  const nyNow = new Date("2026-01-15T12:00:00.000Z"); // 07:00 NY
  const rollingWindow = getRollingLocalWindow("America/New_York", nyNow, 14);
  const eightDaysAgoNY = sess({
    task_id: "t1",
    started_at: new Date(nyNow.getTime() - 8 * 86400000).toISOString(),
    tasks: { goals: { id: "g1", title: "G1" }, goal_id: "g1" },
  });
  const goals = [goal("g1")];
  const notNeglected = getNeglectedGoalSignals(goals, [eightDaysAgoNY], rollingWindow, { now: nyNow });
  assert.equal(notNeglected.length, 0);
});

test("rolling neglected: DST spring forward New York — 23h day accounted", () => {
  // NY DST 2026-03-08 is 23h. Window spanning it should still be 14 local days.
  const now = new Date("2026-03-09T12:00:00.000Z"); // 08:00 NY after DST
  const window = getRollingLocalWindow("America/New_York", now, 14);
  // Activity 8 days ago before DST: 2026-03-01 10:00 NY = 2026-03-01T15:00Z (EST)
  const beforeDST = sess({
    task_id: "t1",
    started_at: "2026-03-01T15:00:00.000Z",
    tasks: { goals: { id: "g1", title: "G1" }, goal_id: "g1" },
  });
  const goals = [goal("g1")];
  const notNeglected = getNeglectedGoalSignals(goals, [beforeDST], window, { now });
  assert.equal(notNeglected.length, 0);

  // Verify window start matches canonical day window for 14 days before local date 2026-03-09 => 2026-02-23
  const expectedStart = getLocalDayWindow("America/New_York", "2026-02-23").startUtcIso;
  assert.equal(window.startIso, expectedStart);
});

test("rolling neglected: DST fall back New York — 25h day accounted", () => {
  const now = new Date("2026-11-02T12:00:00.000Z"); // 07:00 NY after fallback (EST)
  const window = getRollingLocalWindow("America/New_York", now, 14);
  const eightDaysAgo = sess({
    task_id: "t1",
    started_at: new Date(now.getTime() - 8 * 86400000).toISOString(),
    tasks: { goals: { id: "g1", title: "G1" }, goal_id: "g1" },
  });
  const goals = [goal("g1")];
  const notNeglected = getNeglectedGoalSignals(goals, [eightDaysAgo], window, { now });
  assert.equal(notNeglected.length, 0);
  const expectedStart = getLocalDayWindow("America/New_York", "2026-10-19").startUtcIso;
  assert.equal(window.startIso, expectedStart);
});

test("rolling neglected: server TZ independence", () => {
  const originalTz = process.env.TZ;
  try {
    const now = new Date("2026-04-22T12:00:00.000Z");
    const goals = [goal("g1")];
    const session = sess({
      task_id: "t1",
      started_at: daysAgo(now, 8),
      tasks: { goals: { id: "g1", title: "G1" }, goal_id: "g1" },
    });

    process.env.TZ = "Asia/Tokyo";
    const w1 = getRollingLocalWindow("America/New_York", now, 14);
    const s1 = getNeglectedGoalSignals(goals, [session], w1, { now });

    process.env.TZ = "UTC";
    const w2 = getRollingLocalWindow("America/New_York", now, 14);
    const s2 = getNeglectedGoalSignals(goals, [session], w2, { now });

    process.env.TZ = "America/Los_Angeles";
    const w3 = getRollingLocalWindow("America/New_York", now, 14);
    const s3 = getNeglectedGoalSignals(goals, [session], w3, { now });

    assert.deepEqual(w1, w2);
    assert.deepEqual(w2, w3);
    assert.deepEqual(s1, s2);
    assert.deepEqual(s2, s3);
    assert.equal(s1.length, 0);
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }
});

test("rolling neglected: exact threshold 13 vs 14 vs 15 days", () => {
  const now = new Date("2026-04-22T12:00:00.000Z");
  const window = getRollingLocalWindow("UTC", now, 14);
  const goals = [goal("g1")];

  // 13 days ago inside
  const thirteen = sess({
    task_id: "t1",
    started_at: daysAgo(now, 13),
    tasks: { goals: { id: "g1", title: "G1" }, goal_id: "g1" },
  });
  assert.equal(getNeglectedGoalSignals(goals, [thirteen], window, { now }).length, 0);

  // 14 days exactly at same wall time is still 12h after window start (since window start midnight)
  // So it will be inside, but we consider "before start" as neglected. We'll test the boundary explicitly above.
  // 15 days definitely outside
  const fifteen = sess({
    task_id: "t2",
    started_at: daysAgo(now, 15),
    tasks: { goals: { id: "g1", title: "G1" }, goal_id: "g1" },
  });
  // For UTC, 15 days ago at noon is 2026-04-07T12:00Z, which is before window start 2026-04-08T00:00Z, so neglected
  assert.equal(getNeglectedGoalSignals(goals, [fifteen], window, { now }).length, 1);
});
