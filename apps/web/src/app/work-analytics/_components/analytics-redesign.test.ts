import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function read(...segments: string[]) {
  return readFileSync(path.join(process.cwd(), "src", ...segments), "utf8");
}

const view = read("app", "work-analytics", "_components", "WorkAnalyticsPageView.tsx");
const interactive = read("app", "work-analytics", "interactive-analytics.tsx");
const chart = read("components", "review", "trend-bar-chart.tsx");
const styles = read("app", "globals.css");

test("EGA-655: analytics keeps four primary metrics in one summary strip", () => {
  assert.match(view, /analytics-kpi-strip/);
  for (const label of [
    "Focused time",
    "Active days",
    "Tasks completed",
    "Estimate delta",
  ]) {
    assert.match(view, new RegExp(label));
  }

  for (const testId of [
    "analytics-kpi-focused-time",
    "analytics-kpi-active-days",
    "analytics-kpi-tasks-completed",
    "analytics-kpi-estimate-accuracy",
  ]) {
    assert.match(view, new RegExp(testId));
  }

  assert.match(view, /analytics-kpi-primary/);
  assert.match(view, /analytics-detail-grid/);
  assert.match(view, /analytics-context-card/);
});

test("EGA-655: estimate accuracy reads as one Estimated vs Tracked comparison", () => {
  assert.match(view, /analytics-accuracy-comparison/);
  assert.match(view, /Estimated/);
  assert.match(view, /Tracked/);
  assert.match(view, /report\.estimateAccuracy\.totalEstimatedMinutes/);
  assert.match(view, /report\.estimateAccuracy\.totalTrackedMinutes/);
  assert.match(view, /report\.estimateAccuracy\.noEstimateCount/);
});

test("EGA-655: selected range owns the dominant chart with one recent support trend", () => {
  const primaryIndex = interactive.indexOf("analytics-primary-chart");
  const secondaryIndex = interactive.indexOf("analytics-secondary-grid");
  assert.ok(primaryIndex > -1 && secondaryIndex > -1);
  assert.ok(primaryIndex < secondaryIndex, "primary chart must precede the support grid");
  assert.match(interactive, /Recent rhythm · 7 days/);
  assert.doesNotMatch(interactive, /title="Last 30 days"/);
  assert.doesNotMatch(interactive, /last30DaysSeries/);
});

test("EGA-655: supporting analytics use readable allocation and insight surfaces", () => {
  assert.match(interactive, /analytics-breakdown-row/);
  assert.match(interactive, /analytics-breakdown-track/);
  assert.match(interactive, /analytics-insights-grid/);
  assert.match(interactive, /Weekly delta/);
  assert.match(interactive, /Longest session/);
});

test("EGA-655: charts keep keyboard access, labels, empty state and reduced motion", () => {
  assert.match(chart, /<button/);
  assert.match(chart, /aria-label=/);
  assert.match(styles, /\.analytics-chart-row-interactive:focus-visible/);
  assert.match(chart, /motion-reduce:transition-none/);
  assert.match(chart, /No tracked time yet/);
  assert.match(chart, /compact\?: boolean/);
});

test("EGA-655: primary KPI and dominant chart follow the selected range", () => {
  assert.match(view, /report\.selectedSummary/);
  assert.match(view, /report\.selectedRangeLabel/);
  assert.match(view, /primarySeries=\{report\.selectedSeries\}/);
  assert.match(interactive, /primarySeries/);
  assert.match(interactive, /primaryTitle/);
});

test("EGA-655: analytics filters stay compact and URL-authoritative", () => {
  const filters = read("app", "work-analytics", "analytics-filters.tsx");
  assert.match(filters, /analytics-filter-controls-compact/);
  assert.match(filters, /analytics-filter-range/);
  assert.match(filters, /analytics-open-toggle/);
  assert.match(filters, /aria-pressed=\{currentIncludeOpen\}/);
  assert.doesNotMatch(filters, /<fieldset/);
  assert.doesNotMatch(filters, /<details/);
  assert.doesNotMatch(filters, /useState/);
  assert.match(filters, /router\.replace/);
});


test("EGA-655: drilldowns respect grouping and recent-chart evidence scope", () => {
  assert.match(interactive, /collectDrilldownSessionsForBucket/);
  assert.match(interactive, /groupBy=\{primaryGroupBy\}/);
  assert.match(view, /recentDateDrilldownIndex=\{report\.recentDateDrilldownIndex\}/);
  assert.match(interactive, /dateDrilldownIndex=\{recentDateDrilldownIndex\}/);
  assert.match(interactive, /groupBy="day"/);
});

test("EGA-655: analytics focus styles use defined design-system focus tokens", () => {
  assert.doesNotMatch(styles, /--accent-subtle/);
  assert.match(styles, /\.analytics-filter-select:focus-visible[\s\S]*var\(--ega-focus-ring\)/);
  assert.match(styles, /\.analytics-open-toggle:focus-visible[\s\S]*var\(--ega-focus-ring\)/);
});
