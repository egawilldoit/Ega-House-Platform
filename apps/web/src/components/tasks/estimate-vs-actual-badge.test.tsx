import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EstimateVsActualBadge } from "./estimate-vs-actual-badge";

test("renders nothing without an estimate (shown only when an estimate exists)", () => {
  assert.equal(
    renderToStaticMarkup(
      <EstimateVsActualBadge estimateMinutes={null} trackedSeconds={3600} />,
    ),
    "",
  );
  assert.equal(
    renderToStaticMarkup(
      <EstimateVsActualBadge estimateMinutes={undefined} trackedSeconds={3600} />,
    ),
    "",
  );
});

test("renders nothing when tracked time is unavailable instead of inventing zero", () => {
  assert.equal(
    renderToStaticMarkup(
      <EstimateVsActualBadge estimateMinutes={60} trackedSeconds={null} />,
    ),
    "",
  );
});

test("renders estimate, tracked time and signed percent for an over-run", () => {
  const markup = renderToStaticMarkup(
    <EstimateVsActualBadge estimateMinutes={120} trackedSeconds={11400} />,
  );

  assert.match(markup, /2h est · 3h 10m tracked, \+58%/);
  assert.match(markup, /data-state="over"/);
  assert.match(markup, /status-badge-warn/);
  // The state is announced even though the visible suffix is the percentage.
  assert.match(markup, /over estimate/);
});

test("renders an under-run with its own state and tone", () => {
  const markup = renderToStaticMarkup(
    <EstimateVsActualBadge estimateMinutes={60} trackedSeconds={3000} />,
  );

  assert.match(markup, /1h est · 50m tracked, -17%/);
  assert.match(markup, /data-state="under"/);
  assert.match(markup, /status-badge-info/);
  assert.match(markup, /under estimate/);
});

test("zero estimate shows tracked time honestly without a percent", () => {
  const markup = renderToStaticMarkup(
    <EstimateVsActualBadge estimateMinutes={0} trackedSeconds={300} />,
  );

  assert.match(markup, /0m est · 5m tracked, over/);
  assert.doesNotMatch(markup, /% est/);
  assert.match(markup, /data-state="over"/);
});

test("an exact match reads as on target rather than +0%", () => {
  const markup = renderToStaticMarkup(
    <EstimateVsActualBadge estimateMinutes={60} trackedSeconds={3600} />,
  );

  assert.match(markup, /1h est · 1h tracked, on estimate/);
  assert.match(markup, /data-state="on_target"/);
});

test("marks a running session in text and for assistive technology", () => {
  const markup = renderToStaticMarkup(
    <EstimateVsActualBadge estimateMinutes={60} trackedSeconds={1800} hasOpenSession />,
  );

  assert.match(markup, /running/);
  assert.match(markup, /including a running timer session/);
});
