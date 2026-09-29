import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import type { WorkActivityCalendar, WorkActivityDay } from "@/lib/services/work-activity-service";

import { toHomeActivityPulse } from "./home-activity-pulse";

function makeDay(date: string, overrides: Partial<WorkActivityDay> = {}): WorkActivityDay {
  return {
    date,
    trackedSeconds: 0,
    sessionCount: 0,
    completedTaskCount: 0,
    isActive: false,
    intensityLevel: 0,
    ...overrides,
  };
}

function makeCalendar(
  days: WorkActivityDay[],
  overrides: Partial<WorkActivityCalendar> = {},
): WorkActivityCalendar {
  return {
    timezone: "UTC",
    startDate: days[0]?.date ?? "",
    endDate: days[days.length - 1]?.date ?? "",
    startUtcIso: "",
    endUtcIso: "",
    days,
    activeDayCount: days.filter((day) => day.isActive).length,
    totalTrackedSeconds: days.reduce((sum, day) => sum + day.trackedSeconds, 0),
    totalCompletedTasks: days.reduce((sum, day) => sum + day.completedTaskCount, 0),
    currentStreak: 0,
    longestStreak: 0,
    bestTrackedDay: null,
    ...overrides,
  };
}

test("EGA-663: Home reads the canonical EGA-662 intensity levels directly", () => {
  const pulse = toHomeActivityPulse(
    makeCalendar([
      makeDay("2026-09-01"),
      makeDay("2026-09-02", { trackedSeconds: 15 * 60, sessionCount: 1, isActive: true, intensityLevel: 1 }),
      makeDay("2026-09-03", { trackedSeconds: 60 * 60, sessionCount: 1, isActive: true, intensityLevel: 2 }),
    ]),
  );

  // Levels come verbatim from the canonical calendar; Home applies no scale of
  // its own (neither the EGA-662 thresholds nor the Review ratio-of-max).
  assert.deepEqual(
    pulse.days.map((day) => day.intensity),
    [0, 1, 2],
  );
});

test("EGA-663: streak, active days, tracked time and completions are canonical inputs", () => {
  const pulse = toHomeActivityPulse(
    makeCalendar(
      [makeDay("2026-09-01"), makeDay("2026-09-02"), makeDay("2026-09-03")],
      {
        currentStreak: 5,
        activeDayCount: 9,
        totalTrackedSeconds: 5400,
        totalCompletedTasks: 3,
      },
    ),
  );

  assert.equal(pulse.currentStreak, 5);
  assert.equal(pulse.activeDays, 9);
  assert.equal(pulse.trackedSeconds, 5400);
  assert.equal(pulse.completedTasks, 3);
  assert.equal(pulse.startDate, "2026-09-01");
  assert.equal(pulse.endDate, "2026-09-03");
});

test("EGA-663: the only Home-computed value is the display session sum over canonical days", () => {
  const pulse = toHomeActivityPulse(
    makeCalendar([
      makeDay("2026-09-01", { sessionCount: 2 }),
      makeDay("2026-09-02", { sessionCount: 1 }),
      makeDay("2026-09-03", { sessionCount: 0 }),
    ]),
  );

  assert.equal(pulse.sessionCount, 3);
});

test("EGA-663: Home consumes the canonical EGA-662 read model and owns no activity semantics", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/app/home/_lib/home-activity-pulse.ts"),
    "utf8",
  );

  // Canonical owner must be the data source.
  assert.ok(source.includes("buildWorkActivityReadModel"));

  // No Home-side intensity scale, bucketing, streak or completion-history logic.
  assert.ok(!source.includes("HOME_ACTIVITY_INTENSITY_THRESHOLDS"));
  assert.ok(!source.includes("resolveActivityIntensityLevel"));
  assert.ok(!source.includes("calculateWorkAnalyticsDailySeries"));
  assert.ok(!source.includes("calculateWorkAnalyticsInsights"));
  assert.ok(!source.includes("getSessionHeatmapIntensityLevel"));
  assert.ok(!source.includes("resolveStreaks"));
  assert.ok(!source.includes("aggregateDailyTrackedSeconds"));
  assert.ok(!source.includes("completed_at"));
  assert.ok(!source.includes("longestStreak"));
});

test("EGA-663: the pulse loader delegates timezone resolution to the canonical read model", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/app/home/_lib/home-activity-pulse.ts"),
    "utf8",
  );

  // The canonical read model resolves timezone via Time Context (EGA-661);
  // Home must not construct its own repository or actor.
  assert.ok(!source.includes("SupabaseTimeContextRepository"));
  assert.ok(!source.includes("createAuthenticatedActor"));
  assert.ok(!source.includes("getTimezone"));
});
