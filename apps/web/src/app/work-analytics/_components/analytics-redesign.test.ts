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

test("EGA-655: analytics exposes a four-metric primary KPI strip", () => {
  assert.match(view, /analytics-kpi-strip/);
  for (const label of ["Focused time", "Active days", "Tasks completed", "Estimate accuracy"]) {
    assert.match(view, new RegExp(label));
  }
  const kpiCount = (view.match(/className="analytics-kpi"/g) ?? []).length;
  assert.equal(kpiCount, 4, "expected exactly four primary KPI cards");
  // Secondary metrics are integrated, not equal-weight cards.
  assert.match(view, /analytics-context-card/);
});

test("EGA-655: estimate accuracy reads as one Estimated vs Tracked comparison", () => {
  assert.match(view, /analytics-accuracy-comparison/);
  assert.match(view, /Estimated/);
  assert.match(view, /Tracked/);
  assert.match(view, /report\.estimateAccuracy\.totalEstimatedMinutes/);
  assert.match(view, /report\.estimateAccuracy\.totalTrackedMinutes/);
  // Secondary coverage context preserved.
  assert.match(view, /report\.estimateAccuracy\.noEstimateCount/);
});

test("EGA-655: one dominant historical chart with compact weekly support", () => {
  const primaryIndex = interactive.indexOf("analytics-primary-chart");
  const secondaryIndex = interactive.indexOf("analytics-secondary-grid");
  assert.ok(primaryIndex > -1 && secondaryIndex > -1);
  assert.ok(primaryIndex < secondaryIndex, "primary chart must precede the secondary grid");
  assert.match(interactive, /title="Last 30 days"/);
  assert.match(interactive, /title="Last 7 days"/);
  // Insights retained (de-emphasized), not deleted.
  assert.match(interactive, /Insights/);
});

test("EGA-655: charts keep keyboard access, labels and reduced motion", () => {
  assert.match(chart, /<button/);
  assert.match(chart, /focus-visible:ring/);
  assert.match(chart, /motion-reduce:transition-none/);
  assert.match(chart, /No tracked time yet/);
});

test("EGA-655: primary KPI and dominant chart follow the selected range", () => {
  assert.match(view, /report\.selectedSummary/);
  assert.match(view, /report\.selectedRangeLabel/);
  assert.match(view, /primarySeries=\{report\.selectedSeries\}/);
  assert.match(interactive, /primarySeries/);
  assert.match(interactive, /primaryTitle/);
});

test("EGA-655: analytics filters are compact and URL-authoritative", () => {
  const filters = read("app", "work-analytics", "analytics-filters.tsx");
  assert.match(filters, /analytics-filter-controls-compact/);
  assert.match(filters, /analytics-filter-range/);
  assert.match(filters, /analytics-filter-more/);
  // No permanently expanded fieldsets and no local state that can disagree with the URL.
  assert.doesNotMatch(filters, /<fieldset/);
  assert.doesNotMatch(filters, /useState/);
  assert.match(filters, /router\.replace/);
});
