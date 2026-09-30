import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWorkActivityCalendar,
  resolveWorkActivityIntensityLevel,
} from "./work-activity-service";
import { toHomeActivityPulse } from "../../app/home/_lib/home-activity-pulse";

test("Work Activity Contract: session-only activity produces active day and correct intensity", () => {
  const calendar = buildWorkActivityCalendar({
    sessions: [
      {
        started_at: "2026-09-20T10:00:00.000Z",
        ended_at: "2026-09-20T11:00:00.000Z", // 3600 seconds -> Level 2
      },
    ],
    completionEvents: [],
    timezone: "UTC",
    startDate: "2026-09-20",
    endDate: "2026-09-20",
    nowIso: "2026-09-20T12:00:00.000Z",
  });

  const day = calendar.days[0];
  assert.equal(day?.date, "2026-09-20");
  assert.equal(day?.trackedSeconds, 3600);
  assert.equal(day?.completedTaskCount, 0);
  assert.equal(day?.intensityLevel, 2);
  assert.equal(day?.isActive, true);
});

test("Work Activity Contract: task-completion-only activity produces active day at Level 1", () => {
  const calendar = buildWorkActivityCalendar({
    sessions: [],
    completionEvents: [
      {
        occurredAt: "2026-09-20T14:30:00.000Z",
      },
    ],
    timezone: "UTC",
    startDate: "2026-09-20",
    endDate: "2026-09-20",
    nowIso: "2026-09-20T18:00:00.000Z",
  });

  const day = calendar.days[0];
  assert.equal(day?.date, "2026-09-20");
  assert.equal(day?.trackedSeconds, 0);
  assert.equal(day?.completedTaskCount, 1);
  assert.equal(day?.intensityLevel, 1);
  assert.equal(day?.isActive, true);
});

test("Work Activity Contract: mixed activity combines tracked time and completions", () => {
  const calendar = buildWorkActivityCalendar({
    sessions: [
      {
        started_at: "2026-09-20T08:00:00.000Z",
        ended_at: "2026-09-20T10:00:00.000Z", // 7200 seconds -> Level 3
      },
    ],
    completionEvents: [
      { occurredAt: "2026-09-20T09:00:00.000Z" },
      { occurredAt: "2026-09-20T11:00:00.000Z" },
    ],
    timezone: "UTC",
    startDate: "2026-09-20",
    endDate: "2026-09-20",
    nowIso: "2026-09-20T18:00:00.000Z",
  });

  const day = calendar.days[0];
  assert.equal(day?.trackedSeconds, 7200);
  assert.equal(day?.completedTaskCount, 2);
  assert.equal(day?.intensityLevel, 3);
  assert.equal(day?.isActive, true);
});

test("Work Activity Contract: zero day produces intensity 0 and inactive state", () => {
  const calendar = buildWorkActivityCalendar({
    sessions: [],
    completionEvents: [],
    timezone: "UTC",
    startDate: "2026-09-20",
    endDate: "2026-09-20",
    nowIso: "2026-09-20T18:00:00.000Z",
  });

  const day = calendar.days[0];
  assert.equal(day?.trackedSeconds, 0);
  assert.equal(day?.completedTaskCount, 0);
  assert.equal(day?.intensityLevel, 0);
  assert.equal(day?.isActive, false);
});

test("Work Activity Contract: Home streak matches Analytics streak and intensity is canonical", () => {
  const calendar = buildWorkActivityCalendar({
    sessions: [
      { started_at: "2026-09-19T10:00:00.000Z", ended_at: "2026-09-19T11:00:00.000Z" },
      { started_at: "2026-09-20T10:00:00.000Z", ended_at: "2026-09-20T11:00:00.000Z" },
    ],
    completionEvents: [],
    timezone: "UTC",
    startDate: "2026-09-18",
    endDate: "2026-09-20",
    nowIso: "2026-09-20T18:00:00.000Z",
  });

  assert.equal(calendar.currentStreak, 2);

  const homePulse = toHomeActivityPulse(calendar);

  // Home pulse current streak must align with canonical analytics calendar streak
  assert.equal(homePulse.currentStreak, calendar.currentStreak);
  assert.equal(homePulse.currentStreak, 2);

  // Home pulse day intensities match resolveWorkActivityIntensityLevel
  for (const pulseDay of homePulse.days) {
    const calendarDay = calendar.days.find((d) => d.date === pulseDay.date);
    if (calendarDay) {
      assert.equal(
        pulseDay.intensity,
        resolveWorkActivityIntensityLevel({
          trackedSeconds: calendarDay.trackedSeconds,
          completedTaskCount: calendarDay.completedTaskCount,
        }),
      );
    }
  }
});
