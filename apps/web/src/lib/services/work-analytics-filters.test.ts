import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  parseRange,
  parseGroupBy,
  parseBreakdownBy,
  parseIncludeOpen,
  parseAnalyticsFilters,
  computeWindowForRange,
  computeDateRangeForWindow,
  buildFilterHref,
  type AnalyticsRange,

  DEFAULT_RANGE,
  DEFAULT_GROUP_BY,
  DEFAULT_BREAKDOWN_BY,
  DEFAULT_INCLUDE_OPEN,
} from "./work-analytics-filters";

describe("parseRange", () => {
  it("returns default for undefined/null", () => {
    assert.equal(parseRange(undefined), DEFAULT_RANGE);
    assert.equal(parseRange(null), DEFAULT_RANGE);
  });

  it("returns valid range values", () => {
    assert.equal(parseRange("today"), "today");
    assert.equal(parseRange("7d"), "7d");
    assert.equal(parseRange("30d"), "30d");
    assert.equal(parseRange("mtm"), "mtm");
    assert.equal(parseRange("prev-month"), "prev-month");
    assert.equal(parseRange("qtd"), "qtd");
  });

  it("falls back to default for invalid values", () => {
    assert.equal(parseRange("invalid"), DEFAULT_RANGE);
    assert.equal(parseRange("90d"), DEFAULT_RANGE);
    assert.equal(parseRange(""), DEFAULT_RANGE);
  });
});

describe("parseGroupBy", () => {
  it("returns default for undefined/null", () => {
    assert.equal(parseGroupBy(undefined), DEFAULT_GROUP_BY);
    assert.equal(parseGroupBy(null), DEFAULT_GROUP_BY);
  });

  it("returns valid groupBy values", () => {
    assert.equal(parseGroupBy("day"), "day");
    assert.equal(parseGroupBy("week"), "week");
    assert.equal(parseGroupBy("month"), "month");
  });

  it("falls back to default for invalid values", () => {
    assert.equal(parseGroupBy("year"), DEFAULT_GROUP_BY);
    assert.equal(parseGroupBy(""), DEFAULT_GROUP_BY);
  });
});

describe("parseBreakdownBy", () => {
  it("returns default for undefined/null", () => {
    assert.equal(parseBreakdownBy(undefined), DEFAULT_BREAKDOWN_BY);
    assert.equal(parseBreakdownBy(null), DEFAULT_BREAKDOWN_BY);
  });

  it("returns valid breakdownBy values", () => {
    assert.equal(parseBreakdownBy("project"), "project");
    assert.equal(parseBreakdownBy("goal"), "goal");
    assert.equal(parseBreakdownBy("task"), "task");
  });

  it("falls back to default for invalid values", () => {
    assert.equal(parseBreakdownBy("invalid"), DEFAULT_BREAKDOWN_BY);
    assert.equal(parseBreakdownBy(""), DEFAULT_BREAKDOWN_BY);
  });
});

describe("parseIncludeOpen", () => {
  it("returns false for undefined/null", () => {
    assert.equal(parseIncludeOpen(undefined), false);
    assert.equal(parseIncludeOpen(null), false);
  });

  it("returns true for truthy string values", () => {
    assert.equal(parseIncludeOpen("true"), true);
    assert.equal(parseIncludeOpen("1"), true);
  });

  it("returns false for other values", () => {
    assert.equal(parseIncludeOpen("false"), false);
    assert.equal(parseIncludeOpen("0"), false);
    assert.equal(parseIncludeOpen(""), false);
    assert.equal(parseIncludeOpen("yes"), false);
  });
});

describe("parseAnalyticsFilters", () => {
  it("returns defaults for empty search params", () => {
    const params = new URLSearchParams();
    const result = parseAnalyticsFilters(params);
    assert.equal(result.range, DEFAULT_RANGE);
    assert.equal(result.groupBy, DEFAULT_GROUP_BY);
    assert.equal(result.breakdownBy, DEFAULT_BREAKDOWN_BY);
    assert.equal(result.includeOpen, DEFAULT_INCLUDE_OPEN);
  });

  it("parses all params correctly when present", () => {
    const params = new URLSearchParams(
      "range=7d&groupBy=week&breakdownBy=goal&includeOpen=true",
    );
    const result = parseAnalyticsFilters(params);
    assert.equal(result.range, "7d");
    assert.equal(result.groupBy, "week");
    assert.equal(result.breakdownBy, "goal");
    assert.equal(result.includeOpen, true);
  });

  it("falls back to defaults for invalid params", () => {
    const params = new URLSearchParams(
      "range=invalid&groupBy=year&breakdownBy=foo&includeOpen=banana",
    );
    const result = parseAnalyticsFilters(params);
    assert.equal(result.range, DEFAULT_RANGE);
    assert.equal(result.groupBy, DEFAULT_GROUP_BY);
    assert.equal(result.breakdownBy, DEFAULT_BREAKDOWN_BY);
    assert.equal(result.includeOpen, DEFAULT_INCLUDE_OPEN);
  });
});

describe("computeWindowForRange", () => {
  const now = new Date("2026-04-27T10:00:00.000Z");

  it("computes today window", () => {
    const w = computeWindowForRange("today", now);
    assert.equal(w.startIso, "2026-04-27T00:00:00.000Z");
    assert.equal(w.endIso, "2026-04-27T10:00:00.000Z");
  });

  it("computes 7d window", () => {
    const w = computeWindowForRange("7d", now);
    assert.equal(w.startIso, "2026-04-20T10:00:00.000Z");
    assert.equal(w.endIso, "2026-04-27T10:00:00.000Z");
  });

  it("computes 30d window", () => {
    const w = computeWindowForRange("30d", now);
    assert.equal(w.startIso, "2026-03-28T10:00:00.000Z");
    assert.equal(w.endIso, "2026-04-27T10:00:00.000Z");
  });

  it("computes mtm (month-to-date) window", () => {
    const w = computeWindowForRange("mtm", now);
    assert.equal(w.startIso, "2026-04-01T00:00:00.000Z");
    assert.equal(w.endIso, "2026-04-27T10:00:00.000Z");
  });

  it("computes prev-month window", () => {
    const w = computeWindowForRange("prev-month", now);
    assert.equal(w.startIso, "2026-03-01T00:00:00.000Z");
    assert.equal(w.endIso, "2026-04-01T00:00:00.000Z");
  });

  it("computes qtd (quarter-to-date) window", () => {
    const w = computeWindowForRange("qtd", now);
    assert.equal(w.startIso, "2026-04-01T00:00:00.000Z");
    assert.equal(w.endIso, "2026-04-27T10:00:00.000Z");
  });

  it("defaults to 30d for unknown range", () => {
    // Cast to any to force an unknown range through default branch
    const w = computeWindowForRange("invalid" as AnalyticsRange, now);
    assert.equal(w.startIso, "2026-03-28T10:00:00.000Z");
    assert.equal(w.endIso, "2026-04-27T10:00:00.000Z");
  });
});

describe("computeDateRangeForWindow", () => {
  it("extracts YYYY-MM-DD from ISO strings", () => {
    const d = computeDateRangeForWindow({
      startIso: "2026-04-01T00:00:00.000Z",
      endIso: "2026-04-27T10:00:00.000Z",
    });
    assert.equal(d.startDate, "2026-04-01");
    assert.equal(d.endDate, "2026-04-27");
  });
});

describe("buildFilterHref", () => {
  it("adds new param to empty params", () => {
    const params = new URLSearchParams();
    const href = buildFilterHref(params, "range", "7d");
    assert.equal(href, "?range=7d");
  });

  it("removes param when value is null", () => {
    const params = new URLSearchParams("range=30d&groupBy=week");
    const href = buildFilterHref(params, "range", null);
    assert.equal(href, "?groupBy=week");
  });

  it("preserves other params when updating one", () => {
    const params = new URLSearchParams("range=30d&groupBy=day");
    const href = buildFilterHref(params, "range", "7d");
    assert.equal(href, "?range=7d&groupBy=day");
  });
});

describe("computeWindowForRange with timezone", () => {
  it("today starts at local midnight in Asia/Tokyo", () => {
    // 2026-04-27T15:30:00Z is 2026-04-28 00:30 in Tokyo (UTC+9).
    const now = new Date("2026-04-27T15:30:00.000Z");
    const d = computeWindowForRange("today", now, "Asia/Tokyo");
    // Local day is 2026-04-28; local midnight is 2026-04-27T15:00:00Z.
    assert.equal(d.startIso, "2026-04-27T15:00:00.000Z");
    assert.equal(d.endIso, "2026-04-27T15:30:00.000Z");
  });

  it("today starts at local midnight in America/New_York", () => {
    // 2026-04-27T03:30:00Z is 2026-04-26 23:30 in New York (UTC-4).
    const now = new Date("2026-04-27T03:30:00.000Z");
    const d = computeWindowForRange("today", now, "America/New_York");
    // Local date is 2026-04-26; local midnight is 2026-04-26T04:00:00Z.
    assert.equal(d.startIso, "2026-04-26T04:00:00.000Z");
  });

  it("month-to-date starts on the 1st of the local month", () => {
    const now = new Date("2026-04-27T15:30:00.000Z");
    const d = computeWindowForRange("mtm", now, "Asia/Tokyo");
    // Local month is April 2026; local midnight Apr 1 is 2026-03-31T15:00:00Z.
    assert.equal(d.startIso, "2026-03-31T15:00:00.000Z");
  });

  it("previous month covers the full local previous calendar month", () => {
    const now = new Date("2026-04-27T15:30:00.000Z");
    const d = computeWindowForRange("prev-month", now, "Asia/Tokyo");
    // Local previous month is March 2026: local midnight Mar 1 .. local midnight Apr 1.
    assert.equal(d.startIso, "2026-02-28T15:00:00.000Z");
    assert.equal(d.endIso, "2026-03-31T15:00:00.000Z");
  });

  it("quarter-to-date starts on the 1st of the local quarter", () => {
    const now = new Date("2026-05-15T12:00:00.000Z");
    const d = computeWindowForRange("qtd", now, "Asia/Tokyo");
    // Local quarter is Q2 2026 (Apr-Jun); local midnight Apr 1 is 2026-03-31T15:00:00Z.
    assert.equal(d.startIso, "2026-03-31T15:00:00.000Z");
  });

  it("rolling 7d window uses local calendar days", () => {
    const now = new Date("2026-04-27T15:30:00.000Z");
    const d = computeWindowForRange("7d", now, "Asia/Tokyo");
    // Local date is 2026-04-28; 7 local days earlier is 2026-04-21 local midnight.
    assert.equal(d.startIso, "2026-04-20T15:00:00.000Z");
  });

  it("omitting timezone keeps legacy UTC behavior", () => {
    const now = new Date("2026-04-27T15:30:00.000Z");
    const d = computeWindowForRange("today", now);
    assert.equal(d.startIso, "2026-04-27T00:00:00.000Z");
  });

  it("today window spans a 25-hour DST fall-back day in America/New_York", () => {
    // 2026-11-01 is the fall-back day (25 hours) in New York.
    const now = new Date("2026-11-01T12:00:00.000Z");
    const d = computeWindowForRange("today", now, "America/New_York");
    // The local day starts at midnight EDT (UTC-4).
    assert.equal(d.startIso, "2026-11-01T04:00:00.000Z");
    // The full local day is 25 hours: midnight EDT to next midnight EST (UTC-5).
    const nextDay = computeWindowForRange("today", new Date("2026-11-02T12:00:00.000Z"), "America/New_York");
    const fullDayHours = (new Date(nextDay.startIso).getTime() - new Date(d.startIso).getTime()) / 3600000;
    assert.equal(fullDayHours, 25);
  });
});

describe("computeDateRangeForWindow with timezone", () => {
  it("returns owner local calendar dates", () => {
    const d = computeDateRangeForWindow(
      { startIso: "2026-03-31T15:00:00.000Z", endIso: "2026-04-27T15:30:00.000Z" },
      "Asia/Tokyo",
    );
    assert.equal(d.startDate, "2026-04-01");
    assert.equal(d.endDate, "2026-04-28");
  });
});
