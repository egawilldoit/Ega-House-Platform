import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SessionHeatmap, getSessionHeatmapIntensityLevel } from "./session-heatmap";

test("maps intensity levels from relative tracked time", () => {
  assert.equal(getSessionHeatmapIntensityLevel(0, 3600), 0);
  assert.equal(getSessionHeatmapIntensityLevel(900, 3600), 1);
  assert.equal(getSessionHeatmapIntensityLevel(1800, 3600), 2);
  assert.equal(getSessionHeatmapIntensityLevel(2700, 3600), 3);
  assert.equal(getSessionHeatmapIntensityLevel(3600, 3600), 4);
});

test("renders legend and day metadata for heatmap data", () => {
  const markup = renderToStaticMarkup(
    <SessionHeatmap
      data={[
        { date: "2026-04-14", trackedSeconds: 0 },
        { date: "2026-04-15", trackedSeconds: 1200 },
        { date: "2026-04-16", trackedSeconds: 3600 },
      ]}
    />,
  );

  assert.match(markup, /Session heatmap/);
  assert.match(markup, /Legend/);
  assert.match(markup, /active days/);
  assert.match(markup, /Fri, Apr 16, 2026|Thu, Apr 16, 2026/);
  assert.match(markup, /tracked/);
  assert.match(markup, /aria-label="Heatmap legend"/);
  assert.match(markup, /aria-label="Wed, Apr 15, 2026: 20m 0s tracked"/);
  assert.match(markup, /title="Thu, Apr 16, 2026: 1h 0m 0s tracked"/);
  assert.match(markup, /tabindex="0"/);
});

test("renders an empty-state message when no day data is provided", () => {
  const markup = renderToStaticMarkup(<SessionHeatmap data={[]} />);

  assert.match(markup, /Session heatmap is unavailable for this period/);
});
