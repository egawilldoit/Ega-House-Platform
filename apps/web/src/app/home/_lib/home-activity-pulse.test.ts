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

test("EGA-663: intensity uses the canonical EGA-662 absolute thresholds, not a ratio scale", () => {
  const pulse = toHomeActivityPulse({
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

  // Canonical absolute scale (EGA-662): 15min (< 30m) -> level 1; 60min
  // (30m..<2h) -> level 2. The Review heatmap's ratio-of-max scale would give
  // 1 and 4 for this window (max 3600s) — that scale must not leak into Home.
  assert.deepEqual(
    pulse.days.map((entry: HomeActivityPulseDay) => entry.intensity),
    [0, 1, 2],
  );
});

test("EGA-663: intensity boundaries match EGA-662 absolute thresholds exactly", () => {
  const levelAt = (workedMinutes: number, completedTaskCount = 0) =>
    toHomeActivityPulse({
      startDate: "2026-09-01",
      endDate: "2026-09-01",
      currentStreak: 0,
      activeDays: 0,
      completedTasks: 0,
      daily: [cell("2026-09-01", workedMinutes, 1, completedTaskCount)],
    }).days[0]?.intensity;

  assert.equal(levelAt(0), 0);
  assert.equal(levelAt(29), 1);
  assert.equal(levelAt(30), 2);
  assert.equal(levelAt(119), 2);
  assert.equal(levelAt(120), 3);
  assert.equal(levelAt(239), 3);
  assert.equal(levelAt(240), 4);
  // Completion-only days are active at level 1 (EGA-662 semantics).
  assert.equal(levelAt(0, 1), 1);
  // Completions never boost an already time-based level.
  assert.equal(levelAt(30, 5), 2);
});

test("EGA-663: streak and active days are canonical inputs, never Home-computed", () => {
  const pulse = toHomeActivityPulse({
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
  assert.ok(source.includes("HOME_ACTIVITY_INTENSITY_THRESHOLDS"));
  assert.ok(source.includes("getWorkAnalyticsSessionsForWindow"));
  assert.ok(source.includes("getWorkAnalyticsTaskCounts"));

  // The Review heatmap ratio scale must not leak into Home.
  assert.ok(!source.includes("getSessionHeatmapIntensityLevel"));

  // No Home-side streak / intensity / bucketing / completion-history ownership.
  assert.ok(!source.includes("resolveStreaks"));
  assert.ok(!source.includes("resolveActivityIntensityLevel"));
  assert.ok(!source.includes("aggregateDailyTrackedSeconds"));
  assert.ok(!source.includes("completed_at"));
  assert.ok(!source.includes("longestStreak"));
});

test("EGA-663: the pulse loader owns no timezone read and no unused DTO field", () => {
  const source = readFileSync(resolve(process.cwd(), "src/app/home/_lib/home-activity-pulse.ts"), "utf8");

  // The grid renders canonical day keys directly; a Home-side timezone read
  // (direct repository construction or otherwise) must not exist.
  assert.ok(!source.includes("SupabaseTimeContextRepository"));
  assert.ok(!source.includes("getTimezone"));
  assert.ok(!source.includes("createAuthenticatedActor"));
});
