import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MoneyRolloverVariancePanel } from "./money-rollover-variance-panel";

const bridge = {
  id: "bridge-1",
  sourcePeriodId: "11111111-1111-4111-8111-111111111111",
  destinationPeriodId: "22222222-2222-4222-8222-222222222222",
  movementId: "33333333-3333-4333-8333-333333333333",
  correctionVersion: 3,
  amountMinor: 1_250,
  direction: "out" as const,
  bookingDate: "2026-11-20",
  applied: false,
  varianceReason: "verified_opening_covered_cutoff" as const,
  createdAt: "2026-12-02T00:00:00.000Z",
};

test("variance panel discloses an unapplied correction without altering the opening", () => {
  const html = renderToStaticMarkup(
    <MoneyRolloverVariancePanel bridges={[bridge]} unavailableReason={null} />,
  );
  assert.match(html, /Historical correction variance/);
  assert.match(html, /verified opening covered cutoff/);
  assert.match(html, /12\.50/);
});

test("variance panel stays hidden when there is no variance", () => {
  assert.equal(
    renderToStaticMarkup(
      <MoneyRolloverVariancePanel
        bridges={[{ ...bridge, applied: true, varianceReason: null }]}
        unavailableReason={null}
      />,
    ),
    "",
  );
});

test("variance panel reports an unavailable disclosure read", () => {
  const html = renderToStaticMarkup(
    <MoneyRolloverVariancePanel
      bridges={null}
      unavailableReason="Historical correction variances could not be loaded right now."
    />,
  );
  assert.match(html, /could not be loaded/);
});

test("variance panel never presents a truncated read as a complete history", () => {
  const html = renderToStaticMarkup(
    <MoneyRolloverVariancePanel
      bridges={[bridge]}
      truncated
      unavailableReason={null}
    />,
  );
  assert.match(html, /only part of this period/i);
  assert.match(html, /Do not treat this list as complete/);
});
