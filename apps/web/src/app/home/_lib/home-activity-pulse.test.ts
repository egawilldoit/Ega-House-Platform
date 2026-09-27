import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  toHomeActivityPulse,
  type HomeActivityPulseDay,
} from "./home-activity-pulse";

function cell(date: string, workedMinutes: number, sessionCount = 1, completedTaskCount = 0) {
  return { date, workedMinutes, sessionCount, completedTaskCount };
}

test("EGA-663: intensity comes from the canonical ratio-based scale, not Home thresholds", () => {
  const pulse = toHomeActivityPulse({
    timezone: "UTC",
    startDate: "2026-09-01",
    endDate: "2026-09-03",
    currentStreak: 0,
    activeDays: 0,
    completedTasks: 0,
    daily: [
      cell("2026-09-01", 0),
      cell("2026-09-02", 15),
      cell("2026-09-03", 60),
    ],
  });

  // Canonical scale: ratio of the window max (3600s). 15min -> ratio 0.25 ->
  // level 1; 60min -> level 4. Home applies no absolute 30m/2h/4h thresholds.
  assert.deepEqual(
    pulse.days.map((entry: HomeActivityPulseDay) => entry.intensity),
    [0, 1, 4],
  );
});

test("EGA-663: streak and active days are canonical inputs, never Home-computed", () => {
  const pulse = toHomeActivityPulse({
    timezone: "UTC",
    startDate: "2026-09-01",
    endDate: "2026-09-04",
    currentStreak: 5,
    activeDays: 9,
    completedTasks: 0,
    daily: [
      cell("2026-09-01", 0),
      cell("2026-09-02", 0),
      cell("2026-09-03", 0),
      cell("2026-09-04", 0),
    ],
  });

  // All-zero canonical cells: Home must not fabricate a streak or active days.
  assert.equal(pulse.currentStreak, 5);
  assert.equal(pulse.activeDays, 9);
});

test("EGA-663: display sums aggregate canonical cells without owning semantics", () => {
  const pulse = toHomeActivityPulse({
    timezone: "UTC",
    startDate: "2026-09-01",
    endDate: "2026-09-03",
    currentStreak: 2,
    activeDays: 2,
    completedTasks: 3,
    daily: [
      cell("2026-09-01", 10, 2),
      cell("2026-09-02", 20, 1),
      cell("2026-09-03", 0, 0),
    ],
  });

  assert.equal(pulse.trackedSeconds, 1800);
  assert.equal(pulse.sessionCount, 3);
  assert.equal(pulse.completedTasks, 3);
});

test("EGA-663: empty history yields zero intensity everywhere, never fabricated activity", () => {
  const pulse = toHomeActivityPulse({
    timezone: "UTC",
    startDate: "2026-09-01",
    endDate: "2026-09-03",
    currentStreak: 0,
    activeDays: 0,
    completedTasks: 0,
    daily: [cell("2026-09-01", 0), cell("2026-09-02", 0), cell("2026-09-03", 0)],
  });

  assert.deepEqual(
    pulse.days.map((entry: HomeActivityPulseDay) => entry.intensity),
    [0, 0, 0],
  );
});

test("EGA-663: Home consumes canonical owners and computes no activity semantics itself", () => {
  const source = readFileSync(resolve(process.cwd(), "src/app/home/_lib/home-activity-pulse.ts"), "utf8");

  // Canonical owners must be the data source.
  assert.ok(source.includes("calculateWorkAnalyticsDailySeries"));
  assert.ok(source.includes("calculateWorkAnalyticsInsights"));
  assert.ok(source.includes("getSessionHeatmapIntensityLevel"));
  assert.ok(source.includes("getWorkAnalyticsSessionsForWindow"));
  assert.ok(source.includes("getWorkAnalyticsTaskCounts"));

  // No Home-side streak / intensity / bucketing / completion-history ownership.
  assert.ok(!source.includes("resolveStreaks"));
  assert.ok(!source.includes("resolveActivityIntensityLevel"));
  assert.ok(!source.includes("aggregateDailyTrackedSeconds"));
  assert.ok(!source.includes("completed_at"));
  assert.ok(!source.includes("longestStreak"));
});
