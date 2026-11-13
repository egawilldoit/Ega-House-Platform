import assert from "node:assert/strict";
import test from "node:test";

import {
  MONEY_STATE_MODES,
  type GetMoneyStateResponse,
  type MoneyStateDto,
} from "../src/money";

test("Money state modes are the two explicit resolutions, never a hidden default", () => {
  assert.deepEqual(MONEY_STATE_MODES, ["today", "active_day"]);
});

test("the state wire shape keeps local today, active date and cutoff separate", () => {
  const state: MoneyStateDto = {
    localToday: "2026-11-13",
    timezone: "Africa/Casablanca",
    period: null,
    opening: {
      status: "unknown",
      amountMinor: null,
      currency: "MAD",
      reason: "no opening",
    },
    cash: {
      available: false,
      currency: "MAD",
      reason: "no opening",
      cutoffDate: "2026-11-13",
    },
    dayClose: null,
    lastClose: null,
    recentCloses: [],
    dayClosesUnavailable: false,
    dateResolution: {
      localToday: "2026-11-13",
      timezone: "Africa/Casablanca",
      activeDate: null,
      periodTimezone: null,
      datesDiffer: false,
      requestedDate: null,
      requestedMode: null,
      resolvedDate: "2026-11-13",
      basis: "local_today_no_period",
      periodRelation: "no_period",
    },
    history: [],
    historyUnavailable: false,
    legacy: {
      available: true,
      totalExpenseCount: 0,
      assignedToPeriodCount: 0,
      inPeriodUnassignedCount: 0,
      bookingDateAssignment: "derived_from_occurred_at_in_owner_timezone",
      reviewRequired: false,
    },
  };
  const response: GetMoneyStateResponse = { ok: true, ...state };
  assert.equal(response.ok, true);
  assert.equal(response.dateResolution.localToday, "2026-11-13");
  assert.equal(response.cash.cutoffDate, "2026-11-13");
});
