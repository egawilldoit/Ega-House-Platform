import { describe, expect, it } from "vitest";

import {
  moneyWallTimeToOccurredAt,
  moneyWriteTimezone,
} from "./money-wall-time";

describe("moneyWriteTimezone", () => {
  it("keeps the Money period as the one date authority when owner and period differ", () => {
    expect(
      moneyWriteTimezone({
        trackingPeriodTimezone: "Africa/Casablanca",
        ownerTimezone: "America/Los_Angeles",
      }),
    ).toBe("Africa/Casablanca");
    expect(
      moneyWriteTimezone({
        trackingPeriodTimezone: null,
        ownerTimezone: "America/Los_Angeles",
      }),
    ).toBe("America/Los_Angeles");
    expect(
      moneyWriteTimezone({
        trackingPeriodTimezone: "  ",
        ownerTimezone: "Africa/Casablanca",
      }),
    ).toBe("Africa/Casablanca");
  });
});

describe("moneyWallTimeToOccurredAt", () => {
  it("interprets a datetime-local wall time in the verified owner timezone", () => {
    expect(
      moneyWallTimeToOccurredAt({
        wallTime: "2026-11-23T00:30",
        timezone: "Africa/Casablanca",
      }),
    ).toEqual({
      ok: true,
      occurredAt: "2026-11-22T23:30:00.000Z",
      bookingDate: "2026-11-23",
    });
    expect(
      moneyWallTimeToOccurredAt({
        wallTime: "2026-11-23T00:30",
        timezone: "America/Los_Angeles",
      }),
    ).toEqual({
      ok: true,
      occurredAt: "2026-11-23T08:30:00.000Z",
      bookingDate: "2026-11-23",
    });
  });

  it("accepts seconds and rejects a wall time that does not exist", () => {
    expect(
      moneyWallTimeToOccurredAt({
        wallTime: "2026-07-15T10:00:30",
        timezone: "America/New_York",
      }),
    ).toEqual({
      ok: true,
      occurredAt: "2026-07-15T14:00:30.000Z",
      bookingDate: "2026-07-15",
    });
    const gap = moneyWallTimeToOccurredAt({
      wallTime: "2026-03-08T02:30",
      timezone: "America/New_York",
    });
    expect(gap.ok).toBe(false);
    if (!gap.ok) expect(gap.error).toMatch(/does not exist/);
  });

  it("rejects a value that is not a local date and time", () => {
    for (const wallTime of ["", "2026-11-23", "2026-11-23T25:00", "noon"]) {
      const result = moneyWallTimeToOccurredAt({
        wallTime,
        timezone: "Africa/Casablanca",
      });
      expect(result.ok).toBe(false);
    }
  });
});
