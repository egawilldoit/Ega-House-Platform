import { describe, expect, it } from "vitest";

import {
  McpInvalidArgumentError,
  composePersonalOpsSummary,
  defaultPersonalOpsSummary,
} from "@/lib/mcp/read-tool-handlers";

const snapshot = {
  date: "2026-11-11",
  timezone: "Africa/Casablanca",
  summary: { trackedTodaySeconds: 3600, trackedTodayLabel: "1h 00m" },
};

describe("personal operations summary spending", () => {
  it("returns canonical spending beside the time snapshot", () => {
    const summary = composePersonalOpsSummary(snapshot, {
      ok: true,
      data: {
        day: { totalMinor: 1100, recordCount: 1 },
        weekToDate: { totalMinor: 1100, recordCount: 1 },
        monthToDate: { totalMinor: 1100, recordCount: 1 },
        coffee: { totalMinor: 1100, recordCount: 1 },
      },
    });

    expect(summary.trackedTodaySeconds).toBe(3600);
    expect(summary.spending).toMatchObject({
      available: true,
      currency: "MAD",
      localDate: "2026-11-11",
      timezone: "Africa/Casablanca",
      day: { totalMinor: 1100 },
      coffeeMonthToDate: { totalMinor: 1100 },
    });
  });

  it("reports a failed summary as unavailable, never as zero spending", () => {
    const summary = composePersonalOpsSummary(snapshot, { ok: false });

    expect(summary.trackedTodaySeconds).toBe(3600);
    expect(summary.spending).toEqual({
      available: false,
      currency: "MAD",
      localDate: "2026-11-11",
      timezone: "Africa/Casablanca",
      reason: "Recorded spending totals are temporarily unavailable.",
    });
    expect(summary.spending).not.toHaveProperty("day");
  });

  it("reports a thrown/absent summary as unavailable while time still returns", () => {
    const summary = composePersonalOpsSummary(snapshot, null);

    expect(summary.trackedTodayLabel).toBe("1h 00m");
    expect(summary.spending).toMatchObject({ available: false });
  });
});

describe("personal operations summary input validation", () => {
  it("classifies an impossible date as INVALID_ARGUMENT, not an outage", async () => {
    await expect(
      defaultPersonalOpsSummary({} as never, "owner", {
        date: "2026-13-40",
        timezone: "Africa/Casablanca",
      }),
    ).rejects.toBeInstanceOf(McpInvalidArgumentError);
  });

  it("classifies an invalid timezone as INVALID_ARGUMENT", async () => {
    await expect(
      defaultPersonalOpsSummary({} as never, "owner", {
        date: "2026-11-11",
        timezone: "Mars/Olympus",
      }),
    ).rejects.toBeInstanceOf(McpInvalidArgumentError);
  });
});
