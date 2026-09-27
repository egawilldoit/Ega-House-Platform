import assert from "node:assert/strict";
import test from "node:test";

import {
  WORK_ACTIVITY_INTENSITY_THRESHOLDS,
  buildWorkActivityCalendar,
  resolveWorkActivityIntensityLevel,
  resolveWorkActivityYearWindow,
} from "./work-activity-service";

const NOW_ISO = "2026-09-27T12:00:00.000Z";

function buildCalendar(overrides: {
  sessions?: Array<{ started_at: string; ended_at: string | null }>;
  completionEvents?: Array<{ occurredAt: string }>;
  timezone?: string;
  startDate?: string;
  endDate?: string;
  nowIso?: string;
} = {}) {
  const timezone = overrides.timezone ?? "UTC";
  const endDate = overrides.endDate ?? "2026-09-27";
  const startDate = overrides.startDate ?? "2026-09-21";
  return buildWorkActivityCalendar({
    sessions: overrides.sessions ?? [],
    completionEvents: overrides.completionEvents ?? [],
    timezone,
    startDate,
    endDate,
    nowIso: overrides.nowIso ?? NOW_ISO,
  });
}

// ── Intensity thresholds ───────────────────────────────────────────────────

test("intensity: zero evidence is level 0", () => {
  assert.equal(resolveWorkActivityIntensityLevel({ trackedSeconds: 0, completedTaskCount: 0 }), 0);
});

test("intensity: task-only day is active at level 1", () => {
  assert.equal(resolveWorkActivityIntensityLevel({ trackedSeconds: 0, completedTaskCount: 1 }), 1);
  assert.equal(resolveWorkActivityIntensityLevel({ trackedSeconds: 0, completedTaskCount: 3 }), 1);
});

test("intensity: tracked time below 30 minutes is level 1", () => {
  assert.equal(
    resolveWorkActivityIntensityLevel({ trackedSeconds: WORK_ACTIVITY_INTENSITY_THRESHOLDS.level1Seconds - 1, completedTaskCount: 0 }),
    1,
  );
});

test("intensity: exactly 30 minutes is level 2 (boundary)", () => {
  assert.equal(
    resolveWorkActivityIntensityLevel({ trackedSeconds: WORK_ACTIVITY_INTENSITY_THRESHOLDS.level1Seconds, completedTaskCount: 0 }),
    2,
  );
});

test("intensity: just below 2 hours is level 2 (boundary)", () => {
  assert.equal(
    resolveWorkActivityIntensityLevel({ trackedSeconds: WORK_ACTIVITY_INTENSITY_THRESHOLDS.level2Seconds - 1, completedTaskCount: 0 }),
    2,
  );
});

test("intensity: exactly 2 hours is level 3 (boundary)", () => {
  assert.equal(
    resolveWorkActivityIntensityLevel({ trackedSeconds: WORK_ACTIVITY_INTENSITY_THRESHOLDS.level2Seconds, completedTaskCount: 0 }),
    3,
  );
});

test("intensity: just below 4 hours is level 3 (boundary)", () => {
  assert.equal(
    resolveWorkActivityIntensityLevel({ trackedSeconds: WORK_ACTIVITY_INTENSITY_THRESHOLDS.level3Seconds - 1, completedTaskCount: 0 }),
    3,
  );
});

test("intensity: exactly 4 hours is level 4 (boundary)", () => {
  assert.equal(
    resolveWorkActivityIntensityLevel({ trackedSeconds: WORK_ACTIVITY_INTENSITY_THRESHOLDS.level3Seconds, completedTaskCount: 0 }),
    4,
  );
});

test("intensity: completed tasks do not boost a time-based level", () => {
  assert.equal(
    resolveWorkActivityIntensityLevel({ trackedSeconds: WORK_ACTIVITY_INTENSITY_THRESHOLDS.level1Seconds, completedTaskCount: 5 }),
    2,
  );
});

// ── Calendar basics ────────────────────────────────────────────────────────

test("calendar: every local date in the window exists exactly once, including zero days", () => {
  const calendar = buildCalendar();
  assert.equal(calendar.days.length, 7);
  const dates = calendar.days.map((day) => day.date);
  assert.deepEqual(dates, [
    "2026-09-21",
    "2026-09-22",
    "2026-09-23",
    "2026-09-24",
    "2026-09-25",
    "2026-09-26",
    "2026-09-27",
  ]);
  assert.equal(new Set(dates).size, 7);
  assert.equal(calendar.activeDayCount, 0);
  assert.equal(calendar.totalTrackedSeconds, 0);
  assert.equal(calendar.totalCompletedTasks, 0);
  assert.equal(calendar.currentStreak, 0);
  assert.equal(calendar.longestStreak, 0);
  assert.equal(calendar.bestTrackedDay, null);
});

test("calendar: timer-only day is active", () => {
  const calendar = buildCalendar({
    sessions: [{ started_at: "2026-09-23T01:00:00.000Z", ended_at: "2026-09-23T02:00:00.000Z" }],
  });
  const day = calendar.days.find((entry) => entry.date === "2026-09-23");
  assert.equal(day?.isActive, true);
  assert.equal(day?.trackedSeconds, 3600);
  assert.equal(day?.sessionCount, 1);
  assert.equal(day?.intensityLevel, 2);
  assert.equal(calendar.activeDayCount, 1);
  assert.equal(calendar.totalTrackedSeconds, 3600);
});

test("calendar: task-only day is active at level 1", () => {
  const calendar = buildCalendar({
    completionEvents: [{ occurredAt: "2026-09-24T10:00:00.000Z" }],
  });
  const day = calendar.days.find((entry) => entry.date === "2026-09-24");
  assert.equal(day?.isActive, true);
  assert.equal(day?.trackedSeconds, 0);
  assert.equal(day?.completedTaskCount, 1);
  assert.equal(day?.intensityLevel, 1);
  assert.equal(calendar.activeDayCount, 1);
  assert.equal(calendar.totalCompletedTasks, 1);
});

test("calendar: zero-evidence day is inactive at level 0", () => {
  const calendar = buildCalendar();
  const day = calendar.days.find((entry) => entry.date === "2026-09-22");
  assert.equal(day?.isActive, false);
  assert.equal(day?.intensityLevel, 0);
});

test("calendar: session crossing local midnight splits across days without double-counting", () => {
  const calendar = buildCalendar({
    sessions: [{ started_at: "2026-09-22T23:30:00.000Z", ended_at: "2026-09-23T00:30:00.000Z" }],
  });
  const day22 = calendar.days.find((entry) => entry.date === "2026-09-22");
  const day23 = calendar.days.find((entry) => entry.date === "2026-09-23");
  assert.equal(day22?.trackedSeconds, 1800);
  assert.equal(day23?.trackedSeconds, 1800);
  assert.equal(calendar.totalTrackedSeconds, 3600);
  assert.equal(day22?.sessionCount, 1);
  assert.equal(day23?.sessionCount, 1);
});

test("calendar: open session is clipped at the query now", () => {
  const calendar = buildCalendar({
    sessions: [{ started_at: "2026-09-27T00:30:00.000Z", ended_at: null }],
    nowIso: "2026-09-27T01:00:00.000Z",
  });
  const day = calendar.days.find((entry) => entry.date === "2026-09-27");
  assert.equal(day?.trackedSeconds, 1800);
});

test("calendar: stale multi-day open session contributes to today only, bounded by now", () => {
  const calendar = buildCalendar({
    sessions: [{ started_at: "2026-09-24T12:00:00.000Z", ended_at: null }],
    nowIso: "2026-09-27T12:00:00.000Z",
  });
  const day24 = calendar.days.find((entry) => entry.date === "2026-09-24");
  const day25 = calendar.days.find((entry) => entry.date === "2026-09-25");
  const day26 = calendar.days.find((entry) => entry.date === "2026-09-26");
  const day27 = calendar.days.find((entry) => entry.date === "2026-09-27");
  assert.equal(day24?.trackedSeconds, 0);
  assert.equal(day25?.trackedSeconds, 0);
  assert.equal(day26?.trackedSeconds, 0);
  assert.equal(day27?.trackedSeconds, 12 * 3600);
  assert.equal(day27?.isActive, true);
  assert.equal(calendar.totalTrackedSeconds, 12 * 3600);
});

// ── Timezone boundaries ────────────────────────────────────────────────────

test("timezone: Asia/Tokyo midnight boundary buckets to the correct local date", () => {
  const session = [{ started_at: "2026-09-26T15:30:00.000Z", ended_at: "2026-09-26T16:00:00.000Z" }];
  const tokyo = buildCalendar({ sessions: session, timezone: "Asia/Tokyo" });
  const tokyoDay = tokyo.days.find((entry) => entry.date === "2026-09-27");
  assert.equal(tokyoDay?.trackedSeconds, 1800);
  assert.equal(tokyo.activeDayCount, 1);

  const utc = buildCalendar({ sessions: session, timezone: "UTC" });
  const utcDay = utc.days.find((entry) => entry.date === "2026-09-26");
  assert.equal(utcDay?.trackedSeconds, 1800);
  assert.equal(utc.activeDayCount, 1);
});

test("timezone: America/New_York late-evening session buckets to the correct local date", () => {
  // 2026-09-26 23:30 EDT (UTC-4) = 2026-09-27T03:30Z. Belongs to 09-26 local.
  const session = [{ started_at: "2026-09-27T03:30:00.000Z", ended_at: "2026-09-27T04:00:00.000Z" }];
  const ny = buildCalendar({ sessions: session, timezone: "America/New_York" });
  const nyDay = ny.days.find((entry) => entry.date === "2026-09-26");
  assert.equal(nyDay?.trackedSeconds, 1800);
  assert.equal(ny.activeDayCount, 1);
});

test("timezone: DST spring-forward 23-hour day in New York is handled", () => {
  const calendar = buildCalendar({
    sessions: [{ started_at: "2026-03-08T05:30:00.000Z", ended_at: "2026-03-08T06:00:00.000Z" }],
    timezone: "America/New_York",
    startDate: "2026-03-08",
    endDate: "2026-03-08",
  });
  const day = calendar.days.find((entry) => entry.date === "2026-03-08");
  assert.equal(day?.trackedSeconds, 1800);
  assert.equal(day?.isActive, true);
});

test("timezone: DST fall-back 25-hour day in New York is handled", () => {
  const calendar = buildCalendar({
    sessions: [{ started_at: "2026-11-01T04:30:00.000Z", ended_at: "2026-11-01T05:30:00.000Z" }],
    timezone: "America/New_York",
    startDate: "2026-11-01",
    endDate: "2026-11-01",
  });
  const day = calendar.days.find((entry) => entry.date === "2026-11-01");
  assert.equal(day?.trackedSeconds, 3600);
  assert.equal(day?.isActive, true);
});

test("timezone: completion event buckets by account-local date, not UTC date", () => {
  const tokyo = buildCalendar({
    completionEvents: [{ occurredAt: "2026-09-27T02:00:00.000Z" }],
    timezone: "Asia/Tokyo",
  });
  const tokyoDay = tokyo.days.find((entry) => entry.date === "2026-09-27");
  assert.equal(tokyoDay?.completedTaskCount, 1);
  assert.equal(tokyoDay?.isActive, true);

  const ny = buildCalendar({
    completionEvents: [{ occurredAt: "2026-09-27T02:00:00.000Z" }],
    timezone: "America/New_York",
  });
  const nyDay = ny.days.find((entry) => entry.date === "2026-09-26");
  assert.equal(nyDay?.completedTaskCount, 1);
});

test("timezone: server process timezone does not change daily buckets", () => {
  const session = [{ started_at: "2026-09-26T15:30:00.000Z", ended_at: "2026-09-26T16:00:00.000Z" }];
  const tokyo = buildCalendar({ sessions: session, timezone: "Asia/Tokyo" });
  assert.equal(tokyo.days.find((entry) => entry.date === "2026-09-27")?.trackedSeconds, 1800);
});

test("timezone: Africa/Casablanca Ramadan offset (UTC+0) buckets to the correct local date", () => {
  // During Ramadan 2026 (~Feb 18 - Mar 19), Africa/Casablanca is UTC+0 instead
  // of its usual UTC+1. A session at 2026-03-01T00:30Z is 00:30 local on 03-01.
  const ramadan = buildCalendar({
    sessions: [{ started_at: "2026-03-01T00:30:00.000Z", ended_at: "2026-03-01T01:00:00.000Z" }],
    timezone: "Africa/Casablanca",
    startDate: "2026-03-01",
    endDate: "2026-03-01",
  });
  const ramadanDay = ramadan.days.find((entry) => entry.date === "2026-03-01");
  assert.equal(ramadanDay?.trackedSeconds, 1800);
  assert.equal(ramadanDay?.isActive, true);

  // Outside Ramadan (UTC+1), the same UTC instant on 2026-01-15T00:30Z is 01:30
  // local on 01-15 — still 01-15, but the day window bounds differ.
  const outside = buildCalendar({
    sessions: [{ started_at: "2026-01-15T00:30:00.000Z", ended_at: "2026-01-15T01:00:00.000Z" }],
    timezone: "Africa/Casablanca",
    startDate: "2026-01-15",
    endDate: "2026-01-15",
  });
  const outsideDay = outside.days.find((entry) => entry.date === "2026-01-15");
  assert.equal(outsideDay?.trackedSeconds, 1800);
});

test("timezone: changing the account timezone reinterprets buckets without rewriting raw timestamps", () => {
  const sessions = [{ started_at: "2026-09-26T15:30:00.000Z", ended_at: "2026-09-26T16:00:00.000Z" }];
  const completionEvents = [{ occurredAt: "2026-09-27T02:00:00.000Z" }];
  const sessionsSnapshot = JSON.parse(JSON.stringify(sessions));
  const completionsSnapshot = JSON.parse(JSON.stringify(completionEvents));

  const tokyo = buildCalendar({ sessions, completionEvents, timezone: "Asia/Tokyo" });
  const utc = buildCalendar({ sessions, completionEvents, timezone: "UTC" });

  // Same raw session buckets to 2026-09-27 in Tokyo (UTC+9) but 2026-09-26 in UTC.
  assert.equal(tokyo.days.find((d) => d.date === "2026-09-27")?.trackedSeconds, 1800);
  assert.equal(utc.days.find((d) => d.date === "2026-09-26")?.trackedSeconds, 1800);
  // Same completion event buckets to 2026-09-27 in Tokyo but 2026-09-26 in New York.
  assert.equal(tokyo.days.find((d) => d.date === "2026-09-27")?.completedTaskCount, 1);

  // Raw timestamps are never rewritten by a timezone change.
  assert.deepEqual(sessions, sessionsSnapshot);
  assert.deepEqual(completionEvents, completionsSnapshot);
});

// ── Year window ────────────────────────────────────────────────────────────

test("year window: rolling year contains 365 local dates ending today", () => {
  const { startDate, endDate } = resolveWorkActivityYearWindow("UTC", new Date(NOW_ISO));
  assert.equal(endDate, "2026-09-27");
  assert.equal(startDate, "2025-09-28");
  const calendar = buildCalendar({ startDate, endDate });
  assert.equal(calendar.days.length, 365);
  assert.equal(calendar.days[0]?.date, "2025-09-28");
  assert.equal(calendar.days[calendar.days.length - 1]?.date, "2026-09-27");
});

test("year window: leap day is included when it falls inside the window", () => {
  const { startDate, endDate } = resolveWorkActivityYearWindow("UTC", new Date("2024-03-01T12:00:00.000Z"));
  const calendar = buildCalendar({ startDate, endDate });
  const dates = calendar.days.map((day) => day.date);
  assert.ok(dates.includes("2024-02-29"));
  assert.equal(calendar.days.length, 365);
});

test("year window: no future dates are invented", () => {
  const calendar = buildCalendar();
  const today = "2026-09-27";
  assert.ok(calendar.days.every((day) => day.date <= today));
  assert.equal(calendar.days[calendar.days.length - 1]?.date, today);
});

// ── Streaks ────────────────────────────────────────────────────────────────

test("streaks: empty year is zero", () => {
  const calendar = buildCalendar();
  assert.equal(calendar.currentStreak, 0);
  assert.equal(calendar.longestStreak, 0);
});

test("streaks: one active day yields one", () => {
  const calendar = buildCalendar({
    sessions: [{ started_at: "2026-09-23T01:00:00.000Z", ended_at: "2026-09-23T02:00:00.000Z" }],
  });
  assert.equal(calendar.longestStreak, 1);
  assert.equal(calendar.currentStreak, 0);
});

test("streaks: gaps break a streak", () => {
  const calendar = buildCalendar({
    sessions: [
      { started_at: "2026-09-21T01:00:00.000Z", ended_at: "2026-09-21T02:00:00.000Z" },
      { started_at: "2026-09-22T01:00:00.000Z", ended_at: "2026-09-22T02:00:00.000Z" },
      { started_at: "2026-09-24T01:00:00.000Z", ended_at: "2026-09-24T02:00:00.000Z" },
      { started_at: "2026-09-25T01:00:00.000Z", ended_at: "2026-09-25T02:00:00.000Z" },
    ],
  });
  assert.equal(calendar.longestStreak, 2);
  assert.equal(calendar.currentStreak, 0);
});

test("streaks: current streak counts from yesterday when today is inactive", () => {
  const calendar = buildCalendar({
    sessions: [
      { started_at: "2026-09-25T01:00:00.000Z", ended_at: "2026-09-25T02:00:00.000Z" },
      { started_at: "2026-09-26T01:00:00.000Z", ended_at: "2026-09-26T02:00:00.000Z" },
    ],
  });
  assert.equal(calendar.currentStreak, 2);
  assert.equal(calendar.longestStreak, 2);
});

test("streaks: current streak includes today when today is active", () => {
  const calendar = buildCalendar({
    sessions: [
      { started_at: "2026-09-26T01:00:00.000Z", ended_at: "2026-09-26T02:00:00.000Z" },
      { started_at: "2026-09-27T01:00:00.000Z", ended_at: "2026-09-27T02:00:00.000Z" },
    ],
  });
  assert.equal(calendar.currentStreak, 2);
});

test("streaks: year-boundary streak is computed inside the loaded window", () => {
  const { startDate, endDate } = resolveWorkActivityYearWindow("UTC", new Date(NOW_ISO));
  const sessions = [];
  for (let i = 0; i < 10; i += 1) {
    const date = new Date(Date.UTC(2025, 8, 28 + i, 1, 0, 0));
    sessions.push({
      started_at: date.toISOString(),
      ended_at: new Date(date.getTime() + 3600_000).toISOString(),
    });
  }
  const calendar = buildCalendar({ startDate, endDate, sessions });
  assert.equal(calendar.longestStreak, 10);
});

test("streaks: leap-day streak continues across Feb 29", () => {
  const calendar = buildCalendar({
    sessions: [
      { started_at: "2024-02-28T01:00:00.000Z", ended_at: "2024-02-28T02:00:00.000Z" },
      { started_at: "2024-02-29T01:00:00.000Z", ended_at: "2024-02-29T02:00:00.000Z" },
      { started_at: "2024-03-01T01:00:00.000Z", ended_at: "2024-03-01T02:00:00.000Z" },
    ],
    startDate: "2024-02-28",
    endDate: "2024-03-01",
  });
  assert.equal(calendar.longestStreak, 3);
  assert.equal(calendar.currentStreak, 3);
});

// ── Best day ───────────────────────────────────────────────────────────────

test("best tracked day picks the maximum tracked day and is deterministic on ties", () => {
  const calendar = buildCalendar({
    sessions: [
      { started_at: "2026-09-23T01:00:00.000Z", ended_at: "2026-09-23T02:00:00.000Z" },
      { started_at: "2026-09-24T01:00:00.000Z", ended_at: "2026-09-24T03:00:00.000Z" },
      { started_at: "2026-09-25T01:00:00.000Z", ended_at: "2026-09-25T02:00:00.000Z" },
  ],
  });
  assert.deepEqual(calendar.bestTrackedDay, { date: "2026-09-24", trackedSeconds: 7200 });
});

test("best tracked day is null when no time was tracked", () => {
  const calendar = buildCalendar({
    completionEvents: [{ occurredAt: "2026-09-24T10:00:00.000Z" }],
  });
  assert.equal(calendar.bestTrackedDay, null);
});

// ── Evidence window ────────────────────────────────────────────────────────

test("evidence window spans exactly the local start/end day bounds", () => {
  const calendar = buildCalendar({
    timezone: "Asia/Tokyo",
    startDate: "2026-09-21",
    endDate: "2026-09-27",
  });
  assert.equal(calendar.startUtcIso, "2026-09-20T15:00:00.000Z");
  assert.equal(calendar.endUtcIso, "2026-09-27T15:00:00.000Z");
});

test("completion events outside the window are ignored", () => {
  const calendar = buildCalendar({
    completionEvents: [
      { occurredAt: "2026-09-20T10:00:00.000Z" },
      { occurredAt: "2026-09-28T10:00:00.000Z" },
    ],
  });
  assert.equal(calendar.totalCompletedTasks, 0);
  assert.equal(calendar.activeDayCount, 0);
});
