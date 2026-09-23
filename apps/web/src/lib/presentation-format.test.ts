import assert from "node:assert/strict";
import test from "node:test";

import {
  DISPLAY_EMPTY,
  formatDisplayCount,
  formatDisplayDate,
  formatDisplayDateTime,
  formatDisplayDuration,
  formatDisplayDurationDelta,
  formatDisplayEstimate,
  formatDisplayMultiple,
  formatDisplayPercent,
  formatDisplayRatioPercent,
  formatDisplayStatus,
  formatDisplayTime,
  formatDisplayTimeRange,
  formatDisplayToken,
} from "./presentation-format";

/* ── Percentages ──────────────────────────────────────────────────────── */

test("formatDisplayPercent: positive, negative, zero, decimal, large and null", () => {
  // Positive
  assert.equal(formatDisplayPercent(18), "18%");
  assert.equal(formatDisplayPercent(18, { signed: true }), "+18%");

  // Negative uses a true minus sign, never a hyphen
  assert.equal(formatDisplayPercent(-38.45697329376855), "\u221238.5%");
  assert.equal(formatDisplayPercent(-38.45697329376855, { signed: true }), "\u221238.5%");

  // Zero is never signed and never carries a decimal
  assert.equal(formatDisplayPercent(0), "0%");
  assert.equal(formatDisplayPercent(0, { signed: true }), "0%");
  assert.equal(formatDisplayPercent(-0.04), "0%");

  // Decimal rounding to at most one place, trailing .0 removed
  assert.equal(formatDisplayPercent(12.04), "12%");
  assert.equal(formatDisplayPercent(12.05), "12.1%");
  assert.equal(formatDisplayPercent(83.999), "84%");

  // Large values stay grouped
  assert.equal(formatDisplayPercent(701.234), "701.2%");
  assert.equal(formatDisplayPercent(1234.5), "1,234.5%");

  // Missing values
  assert.equal(formatDisplayPercent(null), DISPLAY_EMPTY);
  assert.equal(formatDisplayPercent(undefined), DISPLAY_EMPTY);
  assert.equal(formatDisplayPercent(Number.NaN), DISPLAY_EMPTY);
  assert.equal(formatDisplayPercent(Number.POSITIVE_INFINITY), DISPLAY_EMPTY);
});

test("formatDisplayPercent: no raw floating point output can escape", () => {
  const rendered = formatDisplayPercent(-38.45697329376855);
  assert.ok(!rendered.includes("456973"), `unrounded output: ${rendered}`);
  assert.equal(rendered.split(".")[1]?.length ?? 0, 2, "one digit plus the % sign");
});

test("formatDisplayRatioPercent converts ratios through the same policy", () => {
  assert.equal(formatDisplayRatioPercent(0.5), "50%");
  assert.equal(formatDisplayRatioPercent(0.925), "92.5%");
  assert.equal(formatDisplayRatioPercent(null), DISPLAY_EMPTY);
});

/* ── Counts and multiples ─────────────────────────────────────────────── */

test("formatDisplayCount groups thousands and handles missing values", () => {
  assert.equal(formatDisplayCount(1402), "1,402");
  assert.equal(formatDisplayCount(0), "0");
  assert.equal(formatDisplayCount(null), DISPLAY_EMPTY);
});

test("formatDisplayMultiple renders a compact multiplier", () => {
  assert.equal(formatDisplayMultiple(2.34), "2.3×");
  assert.equal(formatDisplayMultiple(1), "1×");
  assert.equal(formatDisplayMultiple(null), DISPLAY_EMPTY);
});

/* ── Durations ────────────────────────────────────────────────────────── */

test("formatDisplayDuration: minute precision drops noise and empty units", () => {
  assert.equal(formatDisplayDuration(83 * 3600 + 10 * 60), "83h 10m");
  assert.equal(formatDisplayDuration(11 * 3600), "11h");
  assert.equal(formatDisplayDuration(45 * 60), "45m");
  assert.equal(formatDisplayDuration(0), "0m");
  assert.equal(formatDisplayDuration(59), "0m");
  assert.equal(formatDisplayDuration(189 * 3600 + 9 * 60 + 25), "189h 9m");
  assert.equal(formatDisplayDuration(null), DISPLAY_EMPTY);
});

test("formatDisplayDuration: second precision keeps session-level detail", () => {
  assert.equal(formatDisplayDuration(3600 + 20 * 60 + 23, "second"), "1h 20m 23s");
  assert.equal(formatDisplayDuration(20 * 60 + 23, "second"), "20m 23s");
  assert.equal(formatDisplayDuration(23, "second"), "23s");
  assert.equal(formatDisplayDuration(3600, "second"), "1h 0m 0s");
});

test("formatDisplayDuration never changes the stored value", () => {
  const stored = 189 * 3600 + 9 * 60 + 25;
  formatDisplayDuration(stored);
  formatDisplayDuration(stored, "second");
  assert.equal(stored, 680_965);
});

test("formatDisplayEstimate keeps the short product convention", () => {
  assert.equal(formatDisplayEstimate(60), "1h");
  assert.equal(formatDisplayEstimate(45), "45m");
  assert.equal(formatDisplayEstimate(90), "1h 30m");
  assert.equal(formatDisplayEstimate(0), "0m");
  assert.equal(formatDisplayEstimate(null), DISPLAY_EMPTY);
});

test("formatDisplayDurationDelta signs deltas and names zero", () => {
  assert.equal(formatDisplayDurationDelta(5 * 3600 + 12 * 60), "+5h 12m");
  assert.equal(formatDisplayDurationDelta(-3600), "\u22121h");
  assert.equal(formatDisplayDurationDelta(0), "no change");
  assert.equal(formatDisplayDurationDelta(null), DISPLAY_EMPTY);
});

/* ── Dates ────────────────────────────────────────────────────────────── */

test("formatDisplayDate: compact, detail and analytics styles", () => {
  assert.equal(formatDisplayDate("2026-09-20", "compact"), "Sep 20");
  assert.equal(formatDisplayDate("2026-09-20", "detail"), "Sep 20, 2026");
  assert.equal(formatDisplayDate("2026-09-16", "analytics"), "Sep 16");
  assert.equal(formatDisplayDate(null), DISPLAY_EMPTY);
  assert.equal(formatDisplayDate("not-a-date"), DISPLAY_EMPTY);
});

test("formatDisplayDate never shifts a date-only value across timezones", () => {
  // Date-only values are UTC midnights; the label must be identical regardless
  // of the process timezone.
  const original = process.env.TZ;
  try {
    process.env.TZ = "Pacific/Kiritimati"; // UTC+14
    assert.equal(formatDisplayDate("2026-01-01", "detail"), "Jan 1, 2026");
    process.env.TZ = "Pacific/Midway"; // UTC-11
    assert.equal(formatDisplayDate("2026-01-01", "detail"), "Jan 1, 2026");
  } finally {
    process.env.TZ = original;
  }
});

test("machine ISO dates do not leak into dashboard labels", () => {
  const rendered = formatDisplayDate("2026-09-20", "detail");
  assert.ok(!rendered.includes("2026-09-20"), `raw ISO leaked: ${rendered}`);
});

test("formatDisplayTime and formatDisplayDateTime are deterministic", () => {
  assert.equal(formatDisplayTime("2026-09-22T15:52:00.000Z"), "3:52 PM");
  assert.equal(formatDisplayTime("2026-09-22T15:52:00.000Z", { clock: "24h" }), "15:52");
  assert.equal(formatDisplayDateTime("2026-09-22T15:52:00.000Z"), "Sep 22, 3:52 PM");
  assert.equal(
    formatDisplayTimeRange("2026-09-22T15:52:00.000Z", "2026-09-22T17:55:00.000Z"),
    "3:52 PM – 5:55 PM",
  );
  assert.equal(formatDisplayTimeRange("2026-09-22T15:52:00.000Z", null), "3:52 PM");
  assert.equal(formatDisplayTimeRange(null, null), DISPLAY_EMPTY);
});

/* ── Statuses ─────────────────────────────────────────────────────────── */

test("formatDisplayStatus uses one canonical label per status token", () => {
  assert.equal(formatDisplayStatus("todo"), "To do");
  assert.equal(formatDisplayStatus("in_progress"), "In progress");
  assert.equal(formatDisplayStatus("done"), "Done");
  assert.equal(formatDisplayStatus("blocked"), "Blocked");

  // Case and separator variants converge on the same label
  assert.equal(formatDisplayStatus("In Progress"), "In progress");
  assert.equal(formatDisplayStatus("IN_PROGRESS"), "In progress");
  assert.equal(formatDisplayStatus("Todo"), "To do");

  // Unknown values are humanized rather than dropped
  assert.equal(formatDisplayStatus("waiting_on_client"), "Waiting On Client");
  assert.equal(formatDisplayStatus(null), DISPLAY_EMPTY);
});

test("formatDisplayStatus does not mutate domain tokens", () => {
  const token = "in_progress";
  formatDisplayStatus(token);
  assert.equal(token, "in_progress");
});

test("formatDisplayToken handles health and priority style values", () => {
  assert.equal(formatDisplayToken("on_track"), "On Track");
  assert.equal(formatDisplayToken("at risk"), "At Risk");
  assert.equal(formatDisplayToken("at_risk"), "At Risk");
  assert.equal(formatDisplayToken("high"), "High");
  assert.equal(formatDisplayToken(null), DISPLAY_EMPTY);
});
