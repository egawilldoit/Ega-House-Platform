import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveActivityIntensityLevel,
  toHomeActivityPulse,
  type HomeActivityPulseDay,
} from "./home-activity-pulse";

function day(date: string, trackedSeconds: number, completedTaskCount = 0) {
  return { date, trackedSeconds, completedTaskCount };
}

test("EGA-663: intensity uses stable absolute thresholds, not window-relative maxima", () => {
  assert.equal(resolveActivityIntensityLevel(0, 0), 0);
  assert.equal(resolveActivityIntensityLevel(0, 1), 1);
  assert.equal(resolveActivityIntensityLevel(1, 0), 1);
  assert.equal(resolveActivityIntensityLevel(29 * 60, 0), 1);
  assert.equal(resolveActivityIntensityLevel(30 * 60, 0), 2);
  assert.equal(resolveActivityIntensityLevel(2 * 60 * 60 - 1, 0), 2);
  assert.equal(resolveActivityIntensityLevel(2 * 60 * 60, 0), 3);
  assert.equal(resolveActivityIntensityLevel(4 * 60 * 60 - 1, 0), 3);
  assert.equal(resolveActivityIntensityLevel(4 * 60 * 60, 0), 4);
  // Completed tasks never boost a time-based level.
  assert.equal(resolveActivityIntensityLevel(2 * 60 * 60, 5), 3);
});

test("EGA-663: active-day rule counts task-only days", () => {
  const pulse = toHomeActivityPulse({
    timezone: "UTC",
    startDate: "2026-09-01",
    endDate: "2026-09-03",
    sessionCount: 0,
    daily: [day("2026-09-01", 0), day("2026-09-02", 0, 2), day("2026-09-03", 600)],
  });

  assert.equal(pulse.activeDays, 2);
  assert.equal(pulse.completedTasks, 2);
  assert.equal(pulse.trackedSeconds, 600);
});

test("EGA-663: current streak counts back from yesterday before today's work begins", () => {
  const pulse = toHomeActivityPulse({
    timezone: "UTC",
    startDate: "2026-09-01",
    endDate: "2026-09-04",
    sessionCount: 0,
    daily: [
      day("2026-09-01", 60),
      day("2026-09-02", 60),
      day("2026-09-03", 60),
      day("2026-09-04", 0),
    ],
  });

  // Today (Sep 4) has no activity yet, so the streak counts back from
  // yesterday: Sep 1-3 = 3 days.
  assert.equal(pulse.currentStreak, 3);
  assert.equal(pulse.longestStreak, 3);
});

test("EGA-663: an active today continues the streak", () => {
  const pulse = toHomeActivityPulse({
    timezone: "UTC",
    startDate: "2026-09-01",
    endDate: "2026-09-04",
    sessionCount: 0,
    daily: [
      day("2026-09-01", 60),
      day("2026-09-02", 60),
      day("2026-09-03", 0),
      day("2026-09-04", 60),
    ],
  });

  // Today is active; the gap on Sep 3 keeps the current streak at 1 while
  // the longest run in the window stays 2.
  assert.equal(pulse.currentStreak, 1);
  assert.equal(pulse.longestStreak, 2);
});

test("EGA-663: empty history yields zero streaks, never fabricated activity", () => {
  const pulse = toHomeActivityPulse({
    timezone: "UTC",
    startDate: "2026-09-01",
    endDate: "2026-09-03",
    sessionCount: 0,
    daily: [day("2026-09-01", 0), day("2026-09-02", 0), day("2026-09-03", 0)],
  });

  assert.equal(pulse.currentStreak, 0);
  assert.equal(pulse.longestStreak, 0);
  assert.equal(pulse.activeDays, 0);
  assert.deepEqual(
    pulse.days.map((entry: HomeActivityPulseDay) => entry.intensity),
    [0, 0, 0],
  );
});

test("EGA-663: gaps break the longest streak deterministically", () => {
  const pulse = toHomeActivityPulse({
    timezone: "UTC",
    startDate: "2026-09-01",
    endDate: "2026-09-10",
    sessionCount: 0,
    daily: [
      day("2026-09-01", 60),
      day("2026-09-02", 60),
      day("2026-09-03", 60),
      day("2026-09-04", 60),
      day("2026-09-05", 0),
      day("2026-09-06", 60),
      day("2026-09-07", 60),
      day("2026-09-08", 0),
      day("2026-09-09", 60),
      day("2026-09-10", 60),
    ],
  });

  assert.equal(pulse.longestStreak, 4);
  assert.equal(pulse.currentStreak, 2);
});
