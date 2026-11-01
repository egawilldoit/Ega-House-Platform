import assert from "node:assert/strict";
import test from "node:test";

import type { HomeActivityPulseDay } from "./home-activity-pulse";
import { buildCompactActivityWeeks } from "./home-activity-grid";

function series(startInclusive: string, count: number): HomeActivityPulseDay[] {
  const days: HomeActivityPulseDay[] = [];
  const start = Date.parse(`${startInclusive}T12:00:00.000Z`);
  for (let index = 0; index < count; index += 1) {
    days.push({
      date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
      intensity: 1,
    });
  }
  return days;
}

function weekdayOf(date: string) {
  return new Date(`${date}T12:00:00.000Z`).getUTCDay();
}

test("compact activity weeks keep every day in its own weekday row", () => {
  // 2026-09-29 is a Tuesday: the window ends mid-week.
  const days = series("2026-07-08", 84);
  assert.equal(days[days.length - 1]?.date, "2026-09-29");
  const weeks = buildCompactActivityWeeks(days, 12);

  for (const week of weeks) {
    week.forEach((day, weekday) => {
      if (day) assert.equal(weekdayOf(day.date), weekday, "day must sit in its weekday row");
    });
  }
});

test("compact activity weeks read oldest-to-newest down the columns", () => {
  // Regression: the previous slice/chunk-by-7 misaligned a mid-week window so
  // two calendar weeks mixed inside one column.
  const weeks = buildCompactActivityWeeks(series("2026-07-08", 84), 12);
  const readOrder = weeks.flatMap((week) =>
    week.filter((day): day is HomeActivityPulseDay => day !== null).map((day) => day.date),
  );
  assert.deepEqual([...readOrder].sort(), readOrder);
});

test("every activity column after the first starts on a Sunday", () => {
  const weeks = buildCompactActivityWeeks(series("2026-08-01", 90), 12);
  for (const week of weeks.slice(1)) {
    assert.notEqual(week[0], null, "a full week column starts on Sunday");
  }
});

test("compact activity weeks handle empty input", () => {
  assert.deepEqual(buildCompactActivityWeeks([], 12), []);
});
