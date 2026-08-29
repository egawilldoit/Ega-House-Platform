import assert from "node:assert/strict";
import test from "node:test";

import {
  getCurrentLocalDayWindow,
  getCurrentWeekWindow,
  getLocalDateInTimezone,
  getLocalDayWindow,
  getWeekWindow,
  isValidIANATimeZone,
} from "../src/time-context";

test("isValidIANATimeZone accepts valid and rejects invalid", () => {
  assert.equal(isValidIANATimeZone("UTC"), true);
  assert.equal(isValidIANATimeZone("America/New_York"), true);
  assert.equal(isValidIANATimeZone("Asia/Tokyo"), true);
  assert.equal(isValidIANATimeZone("Europe/Paris"), true);
  assert.equal(isValidIANATimeZone("Invalid/Zone"), false);
  assert.equal(isValidIANATimeZone(""), false);
  assert.equal(isValidIANATimeZone("   "), false);
  assert.equal(isValidIANATimeZone("UTC/Invalid"), false);
});

test("getLocalDayWindow UTC normal 24h", () => {
  const w = getLocalDayWindow("UTC", "2026-01-15");
  assert.equal(w.timezone, "UTC");
  assert.equal(w.fallback, "none");
  assert.equal(w.startUtcIso, "2026-01-15T00:00:00.000Z");
  assert.equal(w.endUtcIso, "2026-01-16T00:00:00.000Z");
  assert.equal(w.durationHours, 24);
});

test("getLocalDayWindow New York normal day 24h", () => {
  const w = getLocalDayWindow("America/New_York", "2026-01-15");
  assert.equal(w.startUtcIso, "2026-01-15T05:00:00.000Z");
  assert.equal(w.endUtcIso, "2026-01-16T05:00:00.000Z");
  assert.equal(w.durationHours, 24);
});

test("getLocalDayWindow Tokyo normal day", () => {
  // Asia/Tokyo UTC+9, midnight local = previous day 15:00 UTC
  const w = getLocalDayWindow("Asia/Tokyo", "2026-01-15");
  assert.equal(w.startUtcIso, "2026-01-14T15:00:00.000Z");
  assert.equal(w.endUtcIso, "2026-01-15T15:00:00.000Z");
  assert.equal(w.durationHours, 24);
});

test("DST spring forward 23h local day America/New_York 2026-03-08", () => {
  const w = getLocalDayWindow("America/New_York", "2026-03-08");
  assert.equal(w.startUtcIso, "2026-03-08T05:00:00.000Z");
  assert.equal(w.endUtcIso, "2026-03-09T04:00:00.000Z");
  assert.equal(w.durationHours, 23);
});

test("DST fall back 25h local day America/New_York 2026-11-01", () => {
  const w = getLocalDayWindow("America/New_York", "2026-11-01");
  assert.equal(w.startUtcIso, "2026-11-01T04:00:00.000Z");
  assert.equal(w.endUtcIso, "2026-11-02T05:00:00.000Z");
  assert.equal(w.durationHours, 25);
});

test("getLocalDayWindow handles invalid timezone fallback explicitly to UTC", () => {
  const w = getLocalDayWindow("Invalid/Zone", "2026-01-15");
  assert.equal(w.timezone, "UTC");
  assert.equal(w.requestedTimezone, "Invalid/Zone");
  assert.equal(w.fallback, "invalid_timezone");
  assert.equal(w.startUtcIso, "2026-01-15T00:00:00.000Z");
  assert.equal(w.endUtcIso, "2026-01-16T00:00:00.000Z");
});

test("getLocalDayWindow handles missing/empty timezone fallback explicitly to UTC", () => {
  const w1 = getLocalDayWindow("", "2026-01-15");
  assert.equal(w1.timezone, "UTC");
  assert.equal(w1.fallback, "missing_timezone");
  assert.equal(w1.requestedTimezone, null);

  const w2 = getLocalDayWindow(null, "2026-01-15");
  assert.equal(w2.fallback, "missing_timezone");

  const w3 = getLocalDayWindow(undefined, "2026-01-15");
  assert.equal(w3.fallback, "missing_timezone");
});

test("getLocalDayWindow handles whitespace timezone as missing", () => {
  const w = getLocalDayWindow("   ", "2026-01-15");
  assert.equal(w.fallback, "missing_timezone");
});

test("getLocalDayWindow trims whitespace timezone", () => {
  const w = getLocalDayWindow("  UTC  ", "2026-01-15");
  assert.equal(w.timezone, "UTC");
  assert.equal(w.fallback, "none");
  assert.equal(w.requestedTimezone, "UTC");
});

test("getLocalDayWindow midnight adjacency no gaps or overlaps", () => {
  const d1 = getLocalDayWindow("America/New_York", "2026-03-07");
  const d2 = getLocalDayWindow("America/New_York", "2026-03-08");
  const d3 = getLocalDayWindow("America/New_York", "2026-03-09");
  assert.equal(d1.endUtcIso, d2.startUtcIso);
  assert.equal(d2.endUtcIso, d3.startUtcIso);

  const utc1 = getLocalDayWindow("UTC", "2026-01-15");
  const utc2 = getLocalDayWindow("UTC", "2026-01-16");
  assert.equal(utc1.endUtcIso, utc2.startUtcIso);
});

test("getLocalDayWindow scheduled Tasks crossing midnight respects local day", () => {
  // In America/New_York, 2026-01-15T05:00:00Z is midnight local 2026-01-15
  // So task at 04:59:59Z belongs to previous local day (2026-01-14)
  const day = getLocalDayWindow("America/New_York", "2026-01-15");
  const inside = "2026-01-15T05:00:00.000Z";
  const before = "2026-01-15T04:59:59.000Z";
  const afterWindow = "2026-01-16T05:00:00.000Z";
  assert.ok(inside >= day.startUtcIso && inside < day.endUtcIso);
  assert.ok(!(before >= day.startUtcIso && before < day.endUtcIso));
  assert.ok(!(afterWindow >= day.startUtcIso && afterWindow < day.endUtcIso));

  // Tokio: midnight 2026-01-15 local is 2026-01-14T15:00:00Z
  const tokyoDay = getLocalDayWindow("Asia/Tokyo", "2026-01-15");
  assert.equal(tokyoDay.startUtcIso, "2026-01-14T15:00:00.000Z");
  assert.equal(tokyoDay.endUtcIso, "2026-01-15T15:00:00.000Z");
  const tokyoInside = "2026-01-14T15:00:00.000Z";
  const tokyoBefore = "2026-01-14T14:59:59.000Z";
  assert.ok(tokyoInside >= tokyoDay.startUtcIso && tokyoInside < tokyoDay.endUtcIso);
  assert.ok(!(tokyoBefore >= tokyoDay.startUtcIso && tokyoBefore < tokyoDay.endUtcIso));
});

test("getLocalDayWindow historical reproducibility same input yields same window", () => {
  const w1 = getLocalDayWindow("America/New_York", "2025-12-25");
  const w2 = getLocalDayWindow("America/New_York", "2025-12-25");
  assert.deepEqual(w1, w2);
  // week also
  const week1 = getWeekWindow("America/New_York", "2025-12-25");
  const week2 = getWeekWindow("America/New_York", "2025-12-25");
  assert.deepEqual(week1, week2);
});

test("getLocalDayWindow server process timezone does not affect result", () => {
  const originalTz = process.env.TZ;
  try {
    process.env.TZ = "Asia/Tokyo";
    // Force Intl caches? Recompute same windows; they must still match expected NY values
    const ny = getLocalDayWindow("America/New_York", "2026-01-15");
    assert.equal(ny.startUtcIso, "2026-01-15T05:00:00.000Z");
    assert.equal(ny.endUtcIso, "2026-01-16T05:00:00.000Z");

    process.env.TZ = "UTC";
    const ny2 = getLocalDayWindow("America/New_York", "2026-01-15");
    assert.deepEqual(ny, ny2);

    process.env.TZ = "America/Los_Angeles";
    const ny3 = getLocalDayWindow("America/New_York", "2026-01-15");
    assert.deepEqual(ny, ny3);
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }
});

test("getLocalDayWindow throws on invalid date", () => {
  assert.throws(() => getLocalDayWindow("UTC", "2026-13-01"), /Invalid date/);
  assert.throws(() => getLocalDayWindow("UTC", "2026-02-30"), /Invalid date/);
  assert.throws(() => getLocalDayWindow("UTC", "not-a-date"), /Invalid date/);
  assert.throws(() => getLocalDayWindow("UTC", "2026/01/15"), /Invalid date/);
});

test("getWeekWindow Monday start policy", () => {
  // 2026-01-15 is Thursday, Monday is 2026-01-12, Sunday 2026-01-18
  const utcWeek = getWeekWindow("UTC", "2026-01-15");
  assert.equal(utcWeek.weekStart, "2026-01-12");
  assert.equal(utcWeek.weekEnd, "2026-01-18");
  assert.equal(utcWeek.weekStartUtcIso, "2026-01-12T00:00:00.000Z");
  assert.equal(utcWeek.weekEndExclusiveUtcIso, "2026-01-19T00:00:00.000Z");

  const nyWeek = getWeekWindow("America/New_York", "2026-01-15");
  assert.equal(nyWeek.weekStart, "2026-01-12");
  assert.equal(nyWeek.weekEnd, "2026-01-18");
  assert.equal(nyWeek.weekStartUtcIso, "2026-01-12T05:00:00.000Z");
  assert.equal(nyWeek.weekEndExclusiveUtcIso, "2026-01-19T05:00:00.000Z");
});

test("getWeekWindow handles Monday edge", () => {
  const monday = getWeekWindow("UTC", "2026-01-12");
  assert.equal(monday.weekStart, "2026-01-12");
  assert.equal(monday.weekEnd, "2026-01-18");
});

test("getWeekWindow handles Sunday edge", () => {
  const sunday = getWeekWindow("UTC", "2026-01-18");
  assert.equal(sunday.weekStart, "2026-01-12");
  assert.equal(sunday.weekEnd, "2026-01-18");
});

test("getWeekWindow adjacent weeks no gaps", () => {
  const w1 = getWeekWindow("America/New_York", "2026-01-05");
  const w2 = getWeekWindow("America/New_York", "2026-01-12");
  assert.equal(w1.weekEndExclusiveUtcIso, w2.weekStartUtcIso);
  assert.equal(w1.weekEnd, "2026-01-11");
  assert.equal(w2.weekStart, "2026-01-12");

  const utc1 = getWeekWindow("UTC", "2026-01-05");
  const utc2 = getWeekWindow("UTC", "2026-01-12");
  assert.equal(utc1.weekEndExclusiveUtcIso, utc2.weekStartUtcIso);
});

test("getWeekWindow DST cross weeks have correct hour span", () => {
  // Week containing DST start: 2026-03-02 Monday to 2026-03-08 Sunday, next Monday is 04:00 UTC
  const dstStartWeek = getWeekWindow("America/New_York", "2026-03-08");
  assert.equal(dstStartWeek.weekStart, "2026-03-02");
  assert.equal(dstStartWeek.weekEnd, "2026-03-08");
  assert.equal(dstStartWeek.weekStartUtcIso, "2026-03-02T05:00:00.000Z");
  assert.equal(dstStartWeek.weekEndExclusiveUtcIso, "2026-03-09T04:00:00.000Z");
  const durationMs = new Date(dstStartWeek.weekEndExclusiveUtcIso).getTime() - new Date(dstStartWeek.weekStartUtcIso).getTime();
  assert.equal(durationMs, 7 * 24 * 3600000 - 3600000); // 167h

  // Week containing DST end: 2026-10-26 Monday to 2026-11-01 Sunday, next Monday 05:00 UTC start 04:00
  const dstEndWeek = getWeekWindow("America/New_York", "2026-11-01");
  assert.equal(dstEndWeek.weekStart, "2026-10-26");
  assert.equal(dstEndWeek.weekEnd, "2026-11-01");
  assert.equal(dstEndWeek.weekStartUtcIso, "2026-10-26T04:00:00.000Z");
  assert.equal(dstEndWeek.weekEndExclusiveUtcIso, "2026-11-02T05:00:00.000Z");
  const durationMs2 = new Date(dstEndWeek.weekEndExclusiveUtcIso).getTime() - new Date(dstEndWeek.weekStartUtcIso).getTime();
  assert.equal(durationMs2, 7 * 24 * 3600000 + 3600000); // 169h
});

test("getWeekWindow invalid/missing timezone fallback", () => {
  const invalid = getWeekWindow("Bad/Zone", "2026-01-15");
  assert.equal(invalid.timezone, "UTC");
  assert.equal(invalid.fallback, "invalid_timezone");
  assert.equal(invalid.weekStart, "2026-01-12");

  const missing = getWeekWindow("", "2026-01-15");
  assert.equal(missing.fallback, "missing_timezone");
  assert.equal(missing.timezone, "UTC");
});

test("getWeekWindow throws on invalid date", () => {
  assert.throws(() => getWeekWindow("UTC", "bad-date"), /Invalid date/);
});

test("getWeekWindow same week different days yield same window", () => {
  const mon = getWeekWindow("America/New_York", "2026-01-12");
  const wed = getWeekWindow("America/New_York", "2026-01-14");
  const sun = getWeekWindow("America/New_York", "2026-01-18");
  assert.equal(mon.weekStart, wed.weekStart);
  assert.equal(mon.weekEnd, wed.weekEnd);
  assert.equal(mon.weekStartUtcIso, wed.weekStartUtcIso);
  assert.equal(mon.weekEndExclusiveUtcIso, sun.weekEndExclusiveUtcIso);
});

test("getLocalDateInTimezone returns correct local date for instants crossing midnight", () => {
  // 2026-01-15T04:59:59Z is still 2026-01-14 in NY (EST UTC-5)
  assert.equal(getLocalDateInTimezone(new Date("2026-01-15T04:59:59.000Z"), "America/New_York"), "2026-01-14");
  assert.equal(getLocalDateInTimezone(new Date("2026-01-15T05:00:00.000Z"), "America/New_York"), "2026-01-15");
  // UTC
  assert.equal(getLocalDateInTimezone(new Date("2026-01-15T00:00:00.000Z"), "UTC"), "2026-01-15");
  assert.equal(getLocalDateInTimezone(new Date("2026-01-14T23:59:59.000Z"), "UTC"), "2026-01-14");
  // Tokyo UTC+9
  assert.equal(getLocalDateInTimezone(new Date("2026-01-14T15:00:00.000Z"), "Asia/Tokyo"), "2026-01-15");
  assert.equal(getLocalDateInTimezone(new Date("2026-01-14T14:59:59.000Z"), "Asia/Tokyo"), "2026-01-14");
});

test("getLocalDateInTimezone fallback for invalid uses UTC", () => {
  const date = new Date("2026-01-15T12:00:00.000Z");
  assert.equal(getLocalDateInTimezone(date, "Invalid/Zone"), "2026-01-15");
  assert.equal(getLocalDateInTimezone(date, ""), "2026-01-15");
});

test("getCurrentLocalDayWindow resolves now to correct local date", () => {
  // 2026-01-15T04:59:59Z => NY still 2026-01-14
  const nowBeforeMidnight = new Date("2026-01-15T04:59:59.000Z");
  const w1 = getCurrentLocalDayWindow("America/New_York", nowBeforeMidnight);
  assert.equal(w1.date, "2026-01-14");
  assert.equal(w1.startUtcIso, "2026-01-14T05:00:00.000Z");

  const nowAtMidnight = new Date("2026-01-15T05:00:00.000Z");
  const w2 = getCurrentLocalDayWindow("America/New_York", nowAtMidnight);
  assert.equal(w2.date, "2026-01-15");
  assert.equal(w2.startUtcIso, "2026-01-15T05:00:00.000Z");
});

test("getCurrentLocalDayWindow fallback preserved", () => {
  const now = new Date("2026-01-15T12:00:00.000Z");
  const w = getCurrentLocalDayWindow("Bad/Zone", now);
  assert.equal(w.fallback, "invalid_timezone");
  assert.equal(w.timezone, "UTC");
});

test("getCurrentWeekWindow resolves correctly", () => {
  const now = new Date("2026-01-15T12:00:00.000Z"); // Thu in both UTC and NY (12UTC=07 NY)
  const week = getCurrentWeekWindow("America/New_York", now);
  assert.equal(week.weekStart, "2026-01-12");
  assert.equal(week.weekEnd, "2026-01-18");
});

test("web and mobile parity: same timezone/date yields same window", () => {
  const timezone = "America/New_York";
  const dateStr = "2026-03-08";
  const webWindow = getLocalDayWindow(timezone, dateStr);
  const mobileWindow = getLocalDayWindow(timezone, dateStr);
  assert.deepEqual(webWindow, mobileWindow);

  const webWeek = getWeekWindow(timezone, dateStr);
  const mobileWeek = getWeekWindow(timezone, dateStr);
  assert.deepEqual(webWeek, mobileWeek);
});
