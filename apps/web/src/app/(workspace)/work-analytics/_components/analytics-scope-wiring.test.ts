import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const view = readFileSync(
  join(process.cwd(), "src/app/work-analytics/_components/WorkAnalyticsPageView.tsx"),
  "utf8",
);

test("the selected-range KPI delta uses the selected-range comparison, not the fixed 7-day context", () => {
  // The defect: a 30-day "Focused time" KPI carried "vs prior 7d", presenting a
  // rolling 7-day comparison as the equivalent comparison for a 30-day range.
  const focusedTimeCardStart = view.indexOf('data-testid="analytics-kpi-focused-time"');
  assert.ok(focusedTimeCardStart >= 0, "focused time KPI must exist");
  const focusedTimeCard = view.slice(focusedTimeCardStart, focusedTimeCardStart + 900);

  assert.match(focusedTimeCard, /report\.selectedComparison/);
  assert.match(focusedTimeCard, /report\.selectedComparisonLabel/);
  assert.doesNotMatch(focusedTimeCard, /weekDelta/);
  assert.doesNotMatch(focusedTimeCard, /vs prior 7d/);
});

test("the fixed 7-day insight stays available as an explicitly labelled context widget", () => {
  assert.match(view, /weekDelta/);
  // It must name itself as a 7-day comparison wherever it is surfaced.
  assert.match(view, /vs prior 7 days|Change vs prior 7 days|prior 7-day/);
});

test("estimate terminology no longer presents variance as accuracy", () => {
  assert.doesNotMatch(view, /Estimate accuracy/);
  assert.match(view, /Estimate variance/);
  assert.match(view, /Tracked vs estimated/);
});

test("analytics copy drops implementation vocabulary", () => {
  assert.doesNotMatch(view, /Windows and months/);
  assert.doesNotMatch(view, /explicit, not decorative/);
  assert.match(view, /Period context/);
});
