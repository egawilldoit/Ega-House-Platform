import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AllocationDonut, FocusTrendChart } from "./analytics-charts";

test("FocusTrendChart renders bars, a supplied trend line and an accessible table", () => {
  const data = [
    { date: "2026-09-14", workedMinutes: 60, sessionCount: 2 },
    { date: "2026-09-15", workedMinutes: 0, sessionCount: 0 },
    { date: "2026-09-16", workedMinutes: 135, sessionCount: 3 },
  ];
  // The trend line must plot a *second* series. Previously the line re-plotted
  // the bar values, which added no information.
  const trendData = [
    { date: "2026-09-14", workedMinutes: 60, sessionCount: 0 },
    { date: "2026-09-15", workedMinutes: 30, sessionCount: 0 },
    { date: "2026-09-16", workedMinutes: 65, sessionCount: 0 },
  ];

  const markup = renderToStaticMarkup(
    <FocusTrendChart
      data={data}
      trendData={trendData}
      variant="bars"
      showTrendLine
      ariaLabel="Focused time test chart"
      tableCaption="Focused time test chart"
      onBucketClick={() => undefined}
    />,
  );

  assert.match(markup, /role="img"/);
  assert.match(markup, /aria-label="Focused time test chart"/);
  assert.match(markup, /data-testid="chart-trend-line"/);
  assert.match(markup, /class="chart-bar"/);
  assert.match(markup, /role="button"/);
  assert.match(markup, /tabindex="0"/);
  assert.match(markup, /<table class="sr-only">/);
  assert.match(markup, /2h 15m/);
});

test("FocusTrendChart draws no trend line when no second series is supplied", () => {
  const data = [
    { date: "2026-09-14", workedMinutes: 60, sessionCount: 2 },
    { date: "2026-09-15", workedMinutes: 30, sessionCount: 1 },
  ];

  const markup = renderToStaticMarkup(
    <FocusTrendChart
      data={data}
      variant="bars"
      showTrendLine
      ariaLabel="Bars only"
      tableCaption="Bars only"
    />,
  );

  assert.doesNotMatch(markup, /data-testid="chart-trend-line"/);
  assert.match(markup, /class="chart-bar"/);
  assert.match(markup, /Daily focus/);
  assert.doesNotMatch(markup, /7-day average/);
});

test("FocusTrendChart legend names both series with the real chart colours", () => {
  const data = [
    { date: "2026-09-14", workedMinutes: 60, sessionCount: 2 },
    { date: "2026-09-15", workedMinutes: 30, sessionCount: 1 },
  ];
  const trendData = [
    { date: "2026-09-14", workedMinutes: 45, sessionCount: 0 },
    { date: "2026-09-15", workedMinutes: 45, sessionCount: 0 },
  ];

  const markup = renderToStaticMarkup(
    <FocusTrendChart
      data={data}
      trendData={trendData}
      variant="bars"
      showTrendLine
      ariaLabel="Legend"
      tableCaption="Legend"
    />,
  );

  assert.match(markup, /Chart legend/);
  assert.match(markup, /Daily focus/);
  assert.match(markup, /7-day average/);
  assert.ok(markup.indexOf("Daily focus") < markup.indexOf("7-day average"));
  assert.match(markup, /color-mix\(in srgb, var\(--ega-data-blue\) 30%, var\(--ega-surface\)\)/);
  assert.match(markup, /background:var\(--ega-data-blue\)/);
  assert.doesNotMatch(
    markup,
    /--ega-data-orange|--ega-data-green|--ega-data-purple|--ega-data-yellow|--ega-data-slate/,
  );
});

test("WeekdayDistributionChart renders seven buckets with an accessible table", async () => {
  const { WeekdayDistributionChart } = await import("./analytics-charts");
  const markup = renderToStaticMarkup(
    <WeekdayDistributionChart
      data={[
        { weekday: 0, label: "Mon", workedMinutes: 60, sessionCount: 2 },
        { weekday: 1, label: "Tue", workedMinutes: 0, sessionCount: 0 },
        { weekday: 2, label: "Wed", workedMinutes: 30, sessionCount: 1 },
        { weekday: 3, label: "Thu", workedMinutes: 0, sessionCount: 0 },
        { weekday: 4, label: "Fri", workedMinutes: 120, sessionCount: 3 },
        { weekday: 5, label: "Sat", workedMinutes: 0, sessionCount: 0 },
        { weekday: 6, label: "Sun", workedMinutes: 15, sessionCount: 1 },
      ]}
      ariaLabel="Weekday distribution"
      tableCaption="Weekday distribution"
    />,
  );

  assert.match(markup, /role="img"/);
  assert.match(markup, /aria-label="Weekday distribution"/);
  assert.match(markup, /<table class="sr-only">/);
  assert.match(markup, /1h/);
  assert.equal((markup.match(/class="chart-bar"/g) ?? []).length, 7);
});

test("FocusTrendChart renders the line variant with an area path", () => {
  const markup = renderToStaticMarkup(
    <FocusTrendChart
      data={[{ date: "2026-09-14", workedMinutes: 30, sessionCount: 1 }]}
      variant="line"
      ariaLabel="Trend"
      tableCaption="Trend"
    />,
  );

  assert.match(markup, /class="chart-area"/);
  assert.match(markup, /class="chart-line"/);
});

test("FocusTrendChart renders its empty state without data", () => {
  const markup = renderToStaticMarkup(
    <FocusTrendChart data={[]} ariaLabel="Empty" tableCaption="Empty" />,
  );
  assert.match(markup, /No tracked time in this window yet/);
});

test("AllocationDonut renders a legend with values and a total", () => {
  const markup = renderToStaticMarkup(
    <AllocationDonut
      segments={[
        { key: "a", label: "Alpha", value: 90, detail: "1h 30m", onSelect: () => undefined },
        { key: "b", label: "Beta", value: 30, detail: "30m" },
      ]}
      totalLabel="2h 0m"
      ariaLabel="Allocation"
      emptyMessage="Nothing here"
    />,
  );

  assert.match(markup, /Alpha/);
  assert.match(markup, /Beta/);
  assert.match(markup, /2h 0m/);
  assert.match(markup, /Total/);
  assert.match(markup, /role="img"/);
});

test("AllocationDonut renders its empty state without data", () => {
  const markup = renderToStaticMarkup(
    <AllocationDonut
      segments={[]}
      totalLabel="0m"
      ariaLabel="Allocation"
      emptyMessage="No tracked time by project in this range yet."
    />,
  );
  assert.match(markup, /No tracked time by project in this range yet/);
});
