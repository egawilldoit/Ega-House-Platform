import assert from "node:assert/strict";
import test from "node:test";

import {
  assessMoneyRollover,
  buildCarryForwardOpening,
  defaultMoneyRolloverRange,
  generateMoneyPeriodWeekWindows,
  inclusiveDayCount,
  moneyRolloverBridgeIdentity,
  moneyRolloverSourceFailure,
  parseMoneyRolloverInput,
  planMoneyRolloverBridge,
  resolveMoneyRolloverSettings,
  shiftDueDateIntoPeriod,
  validateMoneyRolloverTargets,
} from "../src/money-rollover";

const endedPeriod = {
  id: "11111111-1111-4111-8111-111111111111",
  startDate: "2026-11-12",
  endDate: "2026-11-30",
  timezone: "Africa/Casablanca",
  lifecycle: "ended" as const,
  activeDate: "2026-11-30",
};

test("default successor follows the source end with the same inclusive length", () => {
  const range = defaultMoneyRolloverRange(endedPeriod);
  assert.deepEqual(range, { startDate: "2026-12-01", endDate: "2026-12-19" });
  assert.equal(inclusiveDayCount(range.startDate, range.endDate), 19);
});

test("month length and partial periods produce valid dates", () => {
  const range = defaultMoneyRolloverRange({
    startDate: "2026-01-01",
    endDate: "2026-01-31",
  });
  assert.deepEqual(range, { startDate: "2026-02-01", endDate: "2026-02-28" });
  assert.equal(inclusiveDayCount(range.startDate, range.endDate), 28);
});

test("only an ended period with every day closed is a rollover source", () => {
  assert.equal(moneyRolloverSourceFailure(endedPeriod), null);
  assert.match(
    moneyRolloverSourceFailure({ ...endedPeriod, lifecycle: "tracking" })?.message ?? "",
    /Close the final day/,
  );
  assert.match(
    moneyRolloverSourceFailure({ ...endedPeriod, activeDate: "2026-11-29" })?.message ?? "",
    /not its end date/,
  );
  assert.match(
    moneyRolloverSourceFailure({ ...endedPeriod, lifecycle: "rolled_over" })?.message ?? "",
    /already rolled over/,
  );
});

test("successor dates cannot overlap the source or leave silent gaps", () => {
  const overlap = validateMoneyRolloverTargets({
    source: endedPeriod,
    startDate: "2026-11-30",
    endDate: "2026-12-10",
    allowUncoveredDays: false,
  });
  assert.equal(overlap.ok, false);
  assert.equal(!overlap.ok && overlap.field, "startDate");

  const gap = validateMoneyRolloverTargets({
    source: endedPeriod,
    startDate: "2026-12-05",
    endDate: "2026-12-20",
    allowUncoveredDays: false,
  });
  assert.equal(gap.ok, false);
  assert.match(!gap.ok ? gap.message : "", /would belong to no period/);

  const allowed = validateMoneyRolloverTargets({
    source: endedPeriod,
    startDate: "2026-12-05",
    endDate: "2026-12-20",
    allowUncoveredDays: true,
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.ok && allowed.value.uncoveredDays, 4);

  const existing = validateMoneyRolloverTargets({
    source: endedPeriod,
    startDate: "2026-12-01",
    endDate: "2026-12-19",
    allowUncoveredDays: false,
    existingRanges: [{ startDate: "2026-12-10", endDate: "2026-12-31" }],
  });
  assert.equal(existing.ok, false);
});

test("parse rejects unknown opening modes and unverified balances", () => {
  const base = {
    sourcePeriodId: endedPeriod.id,
    expectedVersion: 2,
    startDate: "2026-12-01",
    endDate: "2026-12-19",
    allowUncoveredDays: false,
  };
  assert.equal(
    parseMoneyRolloverInput({ ...base, opening: { mode: "magic" } }).ok,
    false,
  );
  assert.equal(
    parseMoneyRolloverInput({
      ...base,
      opening: { mode: "verified_source", amountMinor: 100 },
    }).ok,
    false,
  );
  const parsed = parseMoneyRolloverInput({
    ...base,
    opening: { mode: "carry_forward" },
    unpaidItems: { treatment: "cancel", reason: "written off" },
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ok && parsed.value.unpaidItems?.treatment, "cancel");
});

test("a carry-forward opening keeps provenance and never invents zero", () => {
  const opening = buildCarryForwardOpening({
    sourcePeriodId: endedPeriod.id,
    sourceEndDate: endedPeriod.endDate,
    closingCashMinor: 68_900,
  });
  assert.equal(opening.amountMinor, 68_900);
  assert.equal(opening.source, "carry_forward");
  assert.equal(opening.cutoffDate, endedPeriod.endDate);
  assert.match(opening.note ?? "", /modeled recorded cash/);
  assert.throws(() =>
    buildCarryForwardOpening({
      sourcePeriodId: endedPeriod.id,
      sourceEndDate: endedPeriod.endDate,
      closingCashMinor: Number.NaN,
    }),
  );
});

test("policy copy is explicit and never silently changes the source settings", () => {
  assert.deepEqual(
    resolveMoneyRolloverSettings({ savingsTargetMinor: 1_000 }, null),
    { savingsTargetMinor: 1_000 },
  );
  assert.deepEqual(
    resolveMoneyRolloverSettings(
      { savingsTargetMinor: 1_000 },
      { savingsTargetMinor: 2_000 },
    ),
    { savingsTargetMinor: 2_000 },
  );
});

test("unknown closing cash blocks carry-forward and is not modeled as zero", () => {
  const result = assessMoneyRollover({
    cutoffDate: "2026-11-30",
    modeledClosingCashMinor: null,
    verifiedClosingCashMinor: null,
    differenceAccepted: false,
    pendingOccurrences: [],
    unpaidChoice: null,
    openingMode: "carry_forward",
    closeSnapshots: { available: true, closeCount: 1, lastClosedDate: "2026-11-30", comparableToRestatedTotals: true, restatedDifferenceCount: 0, restatedDifferences: [], paidObligationCount: 0, paidObligationMismatchCount: 0, countedVisitCount: 0, countedVisitMismatchCount: 0, savingsTargetMinor: null, savingsTransferredMinor: 0 },
  });
  assert.equal(result.blockers.length, 1);
  assert.match(result.blockers[0], /unknown/);
  assert.equal(
    result.differences.find((entry) => entry.code === "unknown_closing_cash")?.status,
    "unavailable",
  );
});

test("a verified difference requires explicit acceptance and keeps the amount", () => {
  const rejected = assessMoneyRollover({
    cutoffDate: "2026-11-30",
    modeledClosingCashMinor: 68_900,
    verifiedClosingCashMinor: 68_000,
    differenceAccepted: false,
    pendingOccurrences: [],
    unpaidChoice: null,
    openingMode: "verified_source",
    closeSnapshots: { available: true, closeCount: 1, lastClosedDate: "2026-11-30", comparableToRestatedTotals: true, restatedDifferenceCount: 0, restatedDifferences: [], paidObligationCount: 0, paidObligationMismatchCount: 0, countedVisitCount: 0, countedVisitMismatchCount: 0, savingsTargetMinor: null, savingsTransferredMinor: 0 },
  });
  assert.equal(rejected.choices.length, 1);
  assert.equal(rejected.differenceMinor, -900);

  const accepted = assessMoneyRollover({
    cutoffDate: "2026-11-30",
    modeledClosingCashMinor: 68_900,
    verifiedClosingCashMinor: 68_000,
    differenceAccepted: true,
    pendingOccurrences: [],
    unpaidChoice: null,
    openingMode: "verified_source",
    closeSnapshots: { available: true, closeCount: 1, lastClosedDate: "2026-11-30", comparableToRestatedTotals: true, restatedDifferenceCount: 0, restatedDifferences: [], paidObligationCount: 0, paidObligationMismatchCount: 0, countedVisitCount: 0, countedVisitMismatchCount: 0, savingsTargetMinor: null, savingsTransferredMinor: 0 },
  });
  assert.equal(accepted.choices.length, 0);
  assert.equal(accepted.differenceAccepted, true);
});

test("unpaid occurrences require an explicit treatment and are never dropped", () => {
  const result = assessMoneyRollover({
    cutoffDate: "2026-11-30",
    modeledClosingCashMinor: 10_000,
    verifiedClosingCashMinor: null,
    differenceAccepted: false,
    pendingOccurrences: [
      { id: "a", amountMinor: 4_000 },
      { id: "b", amountMinor: 6_000 },
    ],
    unpaidChoice: null,
    openingMode: "carry_forward",
    closeSnapshots: { available: true, closeCount: 1, lastClosedDate: "2026-11-30", comparableToRestatedTotals: true, restatedDifferenceCount: 0, restatedDifferences: [], paidObligationCount: 0, paidObligationMismatchCount: 0, countedVisitCount: 0, countedVisitMismatchCount: 0, savingsTargetMinor: null, savingsTransferredMinor: 0 },
  });
  assert.equal(result.pendingOccurrenceCount, 2);
  assert.equal(result.pendingOccurrenceMinor, 10_000);
  assert.equal(result.choices.length, 1);
  assert.match(result.choices[0], /keep_pending/);
});

test("missing close snapshots are reported as unavailable, not passed", () => {
  const result = assessMoneyRollover({
    cutoffDate: "2026-11-30",
    modeledClosingCashMinor: 10_000,
    verifiedClosingCashMinor: null,
    differenceAccepted: false,
    pendingOccurrences: [],
    unpaidChoice: null,
    openingMode: "carry_forward",
    closeSnapshots: { available: false, reason: "no_close_evidence" },
  });
  assert.equal(
    result.differences.find((entry) => entry.code === "close_snapshot_restatement")
      ?.status,
    "unavailable",
  );
});

test("restated close snapshots require explicit acceptance before rollover", () => {
  const pending = assessMoneyRollover({
    cutoffDate: "2026-11-30",
    modeledClosingCashMinor: 10_000,
    verifiedClosingCashMinor: null,
    differenceAccepted: false,
    pendingOccurrences: [],
    unpaidChoice: null,
    openingMode: "carry_forward",
    closeSnapshots: {
      available: true,
      closeCount: 19,
      lastClosedDate: "2026-11-30",
      comparableToRestatedTotals: true,
      restatedDifferenceCount: 1,
      paidObligationCount: 0,
      paidObligationMismatchCount: 0,
      countedVisitCount: 0,
      countedVisitMismatchCount: 0,
      savingsTargetMinor: null,
      savingsTransferredMinor: 0,
      restatedDifferences: [
        {
          closeId: "close-1",
          closeDate: "2026-11-20",
          changedFields: ["expenseTotal", "recordedCash"],
        },
      ],
    },
  });
  assert.equal(
    pending.differences.find((entry) => entry.code === "close_snapshot_restatement")
      ?.status,
    "choice_required",
  );
  assert.equal(pending.choices.length, 1);

  const accepted = assessMoneyRollover({
    cutoffDate: "2026-11-30",
    modeledClosingCashMinor: 10_000,
    verifiedClosingCashMinor: null,
    differenceAccepted: true,
    pendingOccurrences: [],
    unpaidChoice: null,
    openingMode: "carry_forward",
    closeSnapshots: {
      available: true,
      closeCount: 19,
      lastClosedDate: "2026-11-30",
      comparableToRestatedTotals: true,
      restatedDifferenceCount: 1,
      paidObligationCount: 0,
      paidObligationMismatchCount: 0,
      countedVisitCount: 0,
      countedVisitMismatchCount: 0,
      savingsTargetMinor: null,
      savingsTransferredMinor: 0,
      restatedDifferences: [
        {
          closeId: "close-1",
          closeDate: "2026-11-20",
          changedFields: ["recordedCash"],
        },
      ],
    },
  });
  assert.equal(accepted.choices.length, 0);
  assert.equal(
    accepted.differences.find((entry) => entry.code === "close_snapshot_restatement")
      ?.status,
    "accepted",
  );
});

test("payment and counted-visit mismatches are reconciliation choices", () => {
  const result = assessMoneyRollover({
    cutoffDate: "2026-11-30",
    modeledClosingCashMinor: 10_000,
    verifiedClosingCashMinor: null,
    differenceAccepted: false,
    pendingOccurrences: [],
    unpaidChoice: null,
    openingMode: "carry_forward",
    closeSnapshots: {
      available: true,
      closeCount: 2,
      lastClosedDate: "2026-11-30",
      comparableToRestatedTotals: true,
      restatedDifferenceCount: 0,
      restatedDifferences: [],
      paidObligationCount: 2,
      paidObligationMismatchCount: 1,
      countedVisitCount: 3,
      countedVisitMismatchCount: 1,
      savingsTargetMinor: 12_000,
      savingsTransferredMinor: 2_000,
    },
  });
  assert.equal(
    result.differences.find(
      (entry) => entry.code === "paid_obligation_payment_mismatch",
    )?.status,
    "choice_required",
  );
  assert.equal(
    result.differences.find((entry) => entry.code === "counted_coffee_visit_mismatch")
      ?.status,
    "choice_required",
  );
  assert.equal(result.choices.length, 2);
  const savings = result.differences.find(
    (entry) => entry.code === "savings_target_vs_transfers",
  );
  assert.equal(savings?.status, "ok");
  assert.equal(savings?.amountMinor, -10_000);
});

test("bridge posts only the incremental delta into derived successors", () => {
  const plan = planMoneyRolloverBridge({
    sourcePeriodId: "source",
    movementId: "movement-1",
    sourceEndDate: "2026-11-30",
    correctionVersion: 3,
    movementBookingDate: "2026-11-20",
    previousCashDeltaMinor: -1_100,
    newCashDeltaMinor: -2_100,
    successors: [
      {
        periodId: "dest-1",
        startDate: "2026-12-01",
        openingVerified: false,
        openingCutoffDate: null,
      },
      {
        periodId: "dest-2",
        startDate: "2027-01-01",
        openingVerified: false,
        openingCutoffDate: null,
      },
    ],
  });
  assert.equal(plan.deltaMinor, -1_000);
  assert.equal(plan.postings.length, 2);
  assert.deepEqual(
    plan.postings.map((posting) => posting.amountMinor),
    [1_000, 1_000],
  );
  assert.equal(plan.postings[0].direction, "out");
  assert.equal(
    plan.postings[0].identity,
    moneyRolloverBridgeIdentity("source", "movement-1", 3, "dest-1"),
  );
});

test("bridge stops at a verified opening without altering it", () => {
  const plan = planMoneyRolloverBridge({
    sourcePeriodId: "source",
    movementId: "movement-1",
    sourceEndDate: "2026-11-30",
    correctionVersion: 4,
    movementBookingDate: "2026-11-20",
    previousCashDeltaMinor: 0,
    newCashDeltaMinor: -1_000,
    successors: [
      {
        periodId: "dest-1",
        startDate: "2026-12-01",
        openingVerified: false,
        openingCutoffDate: null,
      },
      {
        periodId: "dest-2",
        startDate: "2027-01-01",
        openingVerified: true,
        openingCutoffDate: "2027-01-01",
      },
      {
        periodId: "dest-3",
        startDate: "2027-02-01",
        openingVerified: false,
        openingCutoffDate: null,
      },
    ],
  });
  assert.deepEqual(
    plan.postings.map((posting) => posting.destinationPeriodId),
    ["dest-1"],
  );
  assert.equal(plan.variances.length, 1);
  assert.equal(plan.variances[0].destinationPeriodId, "dest-2");
  assert.equal(plan.variances[0].reason, "verified_opening_covered_cutoff");
});

test("post-cutoff corrections do not bridge", () => {
  const plan = planMoneyRolloverBridge({
    sourcePeriodId: "source",
    movementId: "movement-1",
    sourceEndDate: "2026-11-30",
    correctionVersion: 5,
    movementBookingDate: "2026-12-05",
    previousCashDeltaMinor: 0,
    newCashDeltaMinor: -1_000,
    successors: [
      {
        periodId: "dest-1",
        startDate: "2026-12-01",
        openingVerified: false,
        openingCutoffDate: null,
      },
    ],
  });
  assert.equal(plan.postings.length, 0);
  assert.equal(plan.noBridge, true);
});

test("week windows are derived from dates and clipped to the period", () => {
  const windows = generateMoneyPeriodWeekWindows({
    startDate: "2026-11-12",
    endDate: "2026-12-19",
    timezone: "Africa/Casablanca",
  });
  assert.equal(windows[0].clippedStart, "2026-11-12");
  assert.equal(windows[0].clippedToPeriod, true);
  assert.equal(windows.at(-1)?.clippedEnd, "2026-12-19");
  assert.equal(windows.every((window) => window.clippedStart <= window.clippedEnd), true);
  assert.equal(
    windows.every((window) => window.clippedEnd <= "2026-12-19"),
    true,
  );
});

test("carried pending due dates shift by the period offset and clamp", () => {
  assert.equal(
    shiftDueDateIntoPeriod({
      dueDate: "2026-11-25",
      sourceStartDate: "2026-11-12",
      targetStartDate: "2026-12-01",
      targetEndDate: "2026-12-19",
    }),
    "2026-12-14",
  );
  assert.equal(
    shiftDueDateIntoPeriod({
      dueDate: "2026-11-30",
      sourceStartDate: "2026-11-12",
      targetStartDate: "2026-12-01",
      targetEndDate: "2026-12-19",
    }),
    "2026-12-19",
  );
});
