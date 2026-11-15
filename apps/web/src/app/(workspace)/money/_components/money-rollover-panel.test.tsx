import assert from "node:assert/strict";
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { test } from "vitest";
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
  assert.match(html, /savings target versus transfers difference/);
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


test("rollover confirmation submits its form", () => {
  const html = renderToStaticMarkup(
    <MoneyRolloverPanel preview={preview()} previewUnavailableReason={null} action={async () => ({ ok: true, error: null })} />,
  );
  const document = new DOMParser().parseFromString(html, "text/html");
  const button = document.querySelector<HTMLButtonElement>("form button");
  assert.equal(button?.textContent, "Roll over to 2026-12-01");
  assert.equal(button?.type, "submit");
});

test("rollover offers editable dates and explicit policy targets", () => {
  const html = renderToStaticMarkup(
    <MoneyRolloverPanel preview={preview()} previewUnavailableReason={null} action={async () => ({ ok: true, error: null })} />,
  );
  assert.match(html, /type="date"[^>]*name="startDate"/);
  assert.match(html, /type="date"[^>]*name="endDate"/);
  assert.match(html, /name="allowUncoveredDays"/);
  assert.match(html, /name="savingsTarget"/);
  assert.match(html, /name="emergencyTarget"/);
  assert.match(html, /current policy will be copied/i);
});


test("refreshing the preview resets dates and identity for the new period", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const action = async () => ({ ok: true as const, error: null });
  const render = async (value: MoneyRolloverPreview | null) => {
    await act(async () => root.render(<MoneyRolloverPanel preview={value} previewUnavailableReason={null} action={action} />));
  };
  try {
    await render(null);
    await render(preview());
    assert.equal(container.querySelector<HTMLInputElement>('[name="startDate"]')?.value, "2026-12-01");
    const firstOperation = container.querySelector<HTMLInputElement>('[name="operationId"]')?.value;
    const current = preview();
    await render(preview({
      source: { ...current.source, periodId: "22222222-2222-4222-8222-222222222222" },
      targets: { ...current.targets, startDate: "2027-01-01", endDate: "2027-01-31" },
    }));
    assert.equal(container.querySelector<HTMLInputElement>('[name="startDate"]')?.value, "2027-01-01");
    assert.equal(container.querySelector<HTMLInputElement>('[name="endDate"]')?.value, "2027-01-31");
    assert.notEqual(container.querySelector<HTMLInputElement>('[name="operationId"]')?.value, firstOperation);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("a rejected rollover preserves the uncovered-days choice for retry", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const submissions: FormData[] = [];
  try {
    await act(async () => root.render(
      <MoneyRolloverPanel preview={preview()} previewUnavailableReason={null} action={async (data) => {
        submissions.push(data);
        return { ok: false, error: "Accept the savings difference" };
      }} />,
    ));
    const checkbox = container.querySelector<HTMLInputElement>('[name="allowUncoveredDays"]');
    const form = container.querySelector<HTMLFormElement>("form");
    assert.ok(checkbox);
    assert.ok(form);
    await act(async () => checkbox.click());
    await act(async () => form.requestSubmit());
    assert.match(container.textContent ?? "", /Accept the savings difference/);
    assert.equal(checkbox.checked, true);
    await act(async () => form.requestSubmit());
    assert.equal(submissions.length, 2);
    assert.equal(submissions[1].get("allowUncoveredDays"), "true");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
