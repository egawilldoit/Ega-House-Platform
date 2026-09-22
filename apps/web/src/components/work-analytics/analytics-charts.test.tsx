import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AllocationDonut, FocusTrendChart } from "./analytics-charts";

test("FocusTrendChart renders bars, line and accessible table", () => {
  const data = [
    { date: "2026-09-14", workedMinutes: 60, sessionCount: 2 },
    { date: "2026-09-15", workedMinutes: 0, sessionCount: 0 },
    { date: "2026-09-16", workedMinutes: 135, sessionCount: 3 },
  ];

  const markup = renderToStaticMarkup(
    <FocusTrendChart
      data={data}
      variant="bars"
      showTrendLine
      ariaLabel="Focused time test chart"
      tableCaption="Focused time test chart"
      onBucketClick={() => undefined}
    />,
  );

  assert.match(markup, /role="img"/);
  assert.match(markup, /aria-label="Focused time test chart"/);
  assert.match(markup, /class="chart-line"/);
  assert.match(markup, /class="chart-bar"/);
  assert.match(markup, /role="button"/);
  assert.match(markup, /tabindex="0"/);
  assert.match(markup, /<table class="sr-only">/);
  assert.match(markup, /2h 15m 0s/);
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
