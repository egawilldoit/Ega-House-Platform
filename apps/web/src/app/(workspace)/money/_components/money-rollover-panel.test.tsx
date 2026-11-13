import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { MoneyRolloverPreview } from "@ega/application";

import { MoneyRolloverPanel } from "./money-rollover-panel";

function preview(overrides: Partial<MoneyRolloverPreview> = {}): MoneyRolloverPreview {
  return {
    source: {
      periodId: "11111111-1111-4111-8111-111111111111",
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      version: 3,
      lifecycle: "ended",
      activeDate: "2026-11-30",
      timezone: "Africa/Casablanca",
    },
    targets: {
      startDate: "2026-12-01",
      endDate: "2026-12-31",
      activeDate: "2026-12-01",
      timezone: "Africa/Casablanca",
      inclusiveDays: 31,
      uncoveredDays: 0,
    },
    openingMode: "carry_forward",
    modeledClosingCashMinor: 68_900,
    proposedOpeningMinor: 68_900,
    settings: { savingsTargetMinor: 12_000 },
    reconciliation: {
      currency: "MAD",
      cutoffDate: "2026-11-30",
      modeledClosingCashMinor: 68_900,
      verifiedClosingCashMinor: null,
      differenceMinor: null,
      differenceAccepted: false,
      pendingOccurrenceCount: 0,
      pendingOccurrenceMinor: 0,
      choices: [],
      blockers: [],
      differences: [],
    },
    closeSnapshots: {
      available: true,
      closeCount: 30,
      requiredCloseCount: 30,
      trackedFromDate: "2026-11-01",
      missingCloseDates: [],
      completeCloseEvidence: true,
      lastClosedDate: "2026-11-30",
      comparableToRestatedTotals: true,
      restatedDifferenceCount: 0,
      restatedDifferences: [],
      paidObligationCount: 0,
      paidObligationMismatchCount: 0,
      countedVisitCount: 0,
      countedVisitMismatchCount: 0,
      savingsTargetMinor: 12_000,
      savingsTransferredMinor: 12_000,
    },
    pendingOccurrences: [],
    pendingOccurrencesTruncated: false,
    priorCorrectionBridges: [],
    priorCorrectionBridgesTruncated: false,
    generatedObligations: [],
    carriedOccurrences: [],
    weekWindows: [],
    ready: true,
    choices: [],
    blockers: [],
    ...overrides,
  };
}

test("rollover panel always offers the acceptance note for a verified balance", () => {
  const html = renderToStaticMarkup(
    <MoneyRolloverPanel
      preview={preview()}
      previewUnavailableReason={null}
      action={async () => ({ ok: true, error: null })}
    />,
  );
  assert.match(html, /name="acceptClosingDifferenceNote"/);
  assert.match(html, /verified balance differs/);
});

test("rollover panel discloses a prior verified-opening variance", () => {
  const html = renderToStaticMarkup(
    <MoneyRolloverPanel
      preview={preview({
        priorCorrectionBridges: [
          {
            id: "bridge-1",
            sourcePeriodId: "11111111-1111-4111-8111-111111111111",
            destinationPeriodId: "22222222-2222-4222-8222-222222222222",
            movementId: "33333333-3333-4333-8333-333333333333",
            correctionVersion: 2,
            amountMinor: 500,
            direction: "out",
            bookingDate: "2026-11-20",
            applied: false,
            varianceReason: "verified_opening_excludes_correction",
            createdAt: "2026-12-02T00:00:00.000Z",
          },
        ],
      })}
      previewUnavailableReason={null}
      action={async () => ({ ok: true, error: null })}
    />,
  );
  assert.match(html, /Historical correction variances/);
  assert.match(html, /verified opening excludes correction/);
});

test("rollover panel discloses a truncated variance history", () => {
  const html = renderToStaticMarkup(
    <MoneyRolloverPanel
      preview={preview({ priorCorrectionBridgesTruncated: true })}
      previewUnavailableReason={null}
      action={async () => ({ ok: true, error: null })}
    />,
  );
  assert.match(html, /Historical correction variances/);
  assert.match(html, /only part of this period/i);
});
