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
const svgChart = read("components", "work-analytics", "analytics-charts.tsx");

test("EGA-655: analytics exposes a four-metric primary KPI strip", () => {
  assert.match(view, /kpi-grid/);
  for (const label of ["Focused time", "Sessions", "Average session", "Estimate variance"]) {
    assert.match(view, new RegExp(label));
  }
  const kpiCount = (view.match(/data-testid="analytics-kpi-/g) ?? []).length;
  assert.equal(kpiCount, 4, "expected exactly four primary KPI cards");
  // Secondary metrics are integrated, not equal-weight cards.
  assert.match(view, /data-testid="analytics-context"/);
});

test("EGA-655: estimate accuracy reads as one Estimated vs Tracked comparison", () => {
  assert.match(view, /data-testid="analytics-accuracy"/);
  assert.match(view, /Estimated/);
  assert.match(view, /Tracked/);
  assert.match(view, /report\.estimateAccuracy\.totalEstimatedMinutes/);
  assert.match(view, /report\.estimateAccuracy\.totalTrackedMinutes/);
  // Secondary coverage context preserved.
  assert.match(view, /report\.estimateAccuracy\.noEstimateCount/);
});

test("EGA-655: one dominant historical chart with compact weekly support", () => {
  const primaryIndex = interactive.indexOf('data-testid="analytics-primary-chart"');
  const secondaryIndex = interactive.indexOf('data-testid="analytics-secondary-grid"');
  assert.ok(primaryIndex > -1 && secondaryIndex > -1);
  assert.ok(primaryIndex < secondaryIndex, "primary chart must precede the secondary grid");
  assert.match(interactive, /Weekly rhythm/);
  assert.match(interactive, /last 30 days/i);
  // Insights retained (de-emphasized), not deleted.
  assert.match(view, /Insights/);
});

test("EGA-655: charts keep keyboard access, labels and reduced motion", () => {
  assert.match(chart, /<button/);
  assert.match(chart, /focus-visible:ring/);
  assert.match(chart, /motion-reduce:transition-none/);
  assert.match(chart, /No tracked time yet/);
  assert.match(chart, /<table className="sr-only">/);

  // Inline-SVG charts stay keyboard reachable and carry accessible text.
  assert.match(svgChart, /role="img"/);
  assert.match(svgChart, /aria-label/);
  assert.match(svgChart, /<table className="sr-only">/);
  assert.match(svgChart, /role=\{interactive \? "button" : undefined\}/);
  assert.match(svgChart, /chart-grid-line/);
  assert.match(svgChart, /chart-line/);
  // No gradients, shadows or decorative filters in the chart grammar.
  assert.doesNotMatch(svgChart, /<linearGradient|<radialGradient|drop-shadow/);
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
  assert.match(filters, /data-testid="analytics-filters"/);
  assert.match(filters, /analytics-filter-range/);
  assert.match(filters, /analytics-filter-more/);
  // Compact control grammar: 32px controls on the white surface.
  assert.match(filters, /h-8/);
  assert.match(filters, /bg-ega-surface/);
  assert.match(filters, /border-ega-border/);
  // No permanently expanded fieldsets and no local state that can disagree with the URL.
  assert.doesNotMatch(filters, /<fieldset/);
  assert.doesNotMatch(filters, /useState/);
  assert.match(filters, /router\.replace/);
});
