import { describe, expect, it } from "vitest";

import { DEFAULT_USER_PREFERENCES } from "@ega/domain/preferences";

import {
  DAYS,
  formatDuration,
  formatHours,
  getGuidanceConflicts,
  getNextGuidance,
  getPlannedGuidanceMinutes,
  getPlannerRange,
  getTargetSeries,
  getWeeklyTotals,
  getZonedClock,
  hasInvalidTargets,
  parseTimeToMinutes,
  type Schedule,
} from "./schedule-model";

function defaultSchedule(): Schedule {
  return structuredClone(DEFAULT_USER_PREFERENCES.personalOperations);
}

describe("weekly totals", () => {
  it("derives 2850 work minutes and 47.5h from a saved Monday 450", () => {
    const schedule = defaultSchedule();
    schedule.targets.monday.work = 450;

    const totals = getWeeklyTotals(schedule);

    expect(totals).toEqual({ work: 2850, jobSearch: 450 });
    expect(formatHours(totals.work)).toBe("47.5h");
    expect(formatHours(totals.jobSearch)).toBe("7.5h");
  });

  it("keeps the new-user defaults at 2880 work and 450 job-search minutes", () => {
    const totals = getWeeklyTotals(defaultSchedule());

    expect(totals).toEqual({ work: 2880, jobSearch: 450 });
    expect(formatHours(totals.work)).toBe("48h");
    expect(formatHours(totals.jobSearch)).toBe("7.5h");
  });

  it("ignores the temporary empty-target sentinel in totals", () => {
    const schedule = defaultSchedule();
    schedule.targets.monday.work = -1;

    expect(getWeeklyTotals(schedule).work).toBe(2400);
    expect(hasInvalidTargets(schedule)).toBe(true);
  });

  it("returns one value per weekday for the sparkline", () => {
    const onlyMonday = defaultSchedule();
    for (const day of DAYS) onlyMonday.targets[day].work = 0;
    onlyMonday.targets.monday.work = 450;

    const series = getTargetSeries(onlyMonday, "work");

    expect(series.monday).toBe(450);
    expect(series.tuesday).toBe(0);
  });
});

describe("time helpers", () => {
  it("parses strict 24-hour times and rejects impossible ones", () => {
    expect(parseTimeToMinutes("06:30")).toBe(390);
    expect(parseTimeToMinutes("24:00")).toBeNull();
    expect(parseTimeToMinutes("6:30")).toBeNull();
    expect(parseTimeToMinutes("")).toBeNull();
  });

  it("formats durations without rounding minutes away", () => {
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(45)).toBe("45m");
  });

  it("includes guidance outside the default 06:00-22:00 window", () => {
    const schedule = defaultSchedule();
    schedule.guidance[0] = {
      ...schedule.guidance[0]!,
      start: "00:15",
      end: "00:45",
      days: ["monday"],
    };
    schedule.guidance[1] = {
      ...schedule.guidance[1]!,
      start: "23:00",
      end: "23:45",
      days: ["monday"],
    };

    expect(getPlannerRange(schedule.guidance)).toEqual({
      startHour: 0,
      endHour: 24,
    });
  });
});

describe("guidance validation", () => {
  it("allows back-to-back enabled blocks", () => {
    const schedule = defaultSchedule();
    schedule.guidance[0] = {
      ...schedule.guidance[0]!,
      start: "06:00",
      end: "06:30",
    };
    schedule.guidance[5] = {
      ...schedule.guidance[5]!,
      enabled: true,
      days: ["monday"],
      start: "06:30",
      end: "07:00",
    };

    expect(getGuidanceConflicts(schedule.guidance).messages).toEqual([]);
  });

  it("reports enabled overlaps but ignores disabled ones", () => {
    const schedule = defaultSchedule();
    schedule.guidance[5] = {
      ...schedule.guidance[5]!,
      enabled: true,
      days: ["monday"],
      start: "06:15",
      end: "07:00",
    };

    const conflicts = getGuidanceConflicts(schedule.guidance);

    expect(conflicts.messages).toEqual(["Startup and Cooking overlap on Monday."]);
    expect(conflicts.badKeys.has("0:monday")).toBe(true);
    expect(conflicts.badKeys.has("5:monday")).toBe(true);

    schedule.guidance[5] = { ...schedule.guidance[5]!, enabled: false };
    expect(getGuidanceConflicts(schedule.guidance).messages).toEqual([]);
  });

  it("reports an end before start even when the block is enabled", () => {
    const schedule = defaultSchedule();
    schedule.guidance[0] = {
      ...schedule.guidance[0]!,
      start: "07:00",
      end: "06:00",
    };

    expect(getGuidanceConflicts(schedule.guidance).messages).toEqual([
      "Startup: end must be after start.",
    ]);
  });

  it("sums planned enabled guidance minutes per day", () => {
    const planned = getPlannedGuidanceMinutes(defaultSchedule().guidance);

    // Startup 30 + Job search 90 + Lunch 60 + Leisure 90 on weekdays.
    expect(planned.monday).toBe(270);
    // Saturday has Startup + Lunch only.
    expect(planned.saturday).toBe(90);
  });
});

describe("next guidance", () => {
  it("finds the next enabled block in the account time zone", () => {
    const next = getNextGuidance(
      defaultSchedule(),
      "UTC",
      new Date("2026-11-09T08:00:00.000Z"),
    );

    expect(next).toMatchObject({
      name: "Job search",
      day: "monday",
      dayOffset: 0,
      startsInMinutes: 150,
      start: "10:30",
    });
  });

  it("looks into the following day when today is done", () => {
    const next = getNextGuidance(
      defaultSchedule(),
      "UTC",
      new Date("2026-11-09T21:00:00.000Z"),
    );

    expect(next).toMatchObject({
      name: "Startup",
      day: "tuesday",
      dayOffset: 1,
    });
  });

  it("hides upcoming guidance while paused", () => {
    const schedule = defaultSchedule();
    schedule.paused = true;

    expect(
      getNextGuidance(schedule, "UTC", new Date("2026-11-09T08:00:00.000Z")),
    ).toBeNull();
  });

  it("falls back safely for an invalid zone", () => {
    expect(
      getNextGuidance(
        defaultSchedule(),
        "Mars/Olympus",
        new Date("2026-11-09T08:00:00.000Z"),
      ),
    ).toBeNull();
    expect(getZonedClock("Mars/Olympus", new Date())).toBeNull();
  });

  it("resolves the weekday in the account zone, not the browser zone", () => {
    // 2026-11-08T23:30Z is already Monday in Tokyo but still Sunday in UTC.
    expect(getZonedClock("Asia/Tokyo", new Date("2026-11-08T23:30:00.000Z"))).toEqual({
      dayIndex: 0,
      minutes: 510,
    });
    expect(getZonedClock("UTC", new Date("2026-11-08T23:30:00.000Z"))).toEqual({
      dayIndex: 6,
      minutes: 1410,
    });
  });
});
