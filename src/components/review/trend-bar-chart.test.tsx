/// <reference types="vitest/globals" />
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TrendBarChart } from "./trend-bar-chart";

test("renders empty state when no data is provided", () => {
  const markup = renderToStaticMarkup(<TrendBarChart data={[]} title="Test Trend" />);
  assert.match(markup, /Test Trend/);
  assert.match(markup, /No tracked time yet/);
});

test("renders chart with daily data", () => {
  const data = [
    { date: "2026-04-20", workedMinutes: 60, sessionCount: 2, completedTaskCount: undefined },
    { date: "2026-04-21", workedMinutes: 0, sessionCount: 0, completedTaskCount: undefined },
    { date: "2026-04-22", workedMinutes: 30, sessionCount: 1, completedTaskCount: undefined },
  ];

  const markup = renderToStaticMarkup(<TrendBarChart data={data} title="Last 7 days" />);

  assert.match(markup, /Last 7 days/);
  assert.match(markup, /active days/);
  assert.match(markup, /1h 30m 0s/); // Total: 90 minutes
  assert.match(markup, /tracked/);
  assert.match(markup, /Mon, Apr 20/);
  assert.match(markup, /1h 0m 0s/);
  assert.match(markup, /30m 0s/);
});

test("renders chart with a single session day", () => {
  const data = [
    { date: "2026-04-27", workedMinutes: 90, sessionCount: 1, completedTaskCount: undefined },
  ];

  const markup = renderToStaticMarkup(<TrendBarChart data={data} title="Today" />);

  assert.match(markup, /Today/);
  assert.match(markup, /active days/);
  assert.match(markup, /1h 30m 0s/);
  assert.match(markup, /Mon, Apr 27/);
});
