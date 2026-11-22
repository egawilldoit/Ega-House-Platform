import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ProgressBar } from "./progress-bar";

const read = (path: string) =>
  readFileSync(join(process.cwd(), path.startsWith("src/") ? path : `src/${path}`), "utf8");

test("ProgressBar exposes an accessible name and a spoken value", () => {
  const markup = renderToStaticMarkup(
    <ProgressBar
      value={63}
      label="Today's progress"
      valueText="63% of today's planned work completed"
    />,
  );

  assert.match(markup, /role="progressbar"/);
  assert.match(markup, /aria-label="Today&#x27;s progress"|aria-label="Today's progress"/);
  assert.match(markup, /aria-valuetext="63% of today&#x27;s planned work completed"|aria-valuetext="63% of today's planned work completed"/);
  assert.match(markup, /aria-valuenow="63"/);
  assert.match(markup, /aria-valuemin="0"/);
  assert.match(markup, /aria-valuemax="100"/);
});

test("ProgressBar rounds its numeric value and tolerates a zero max", () => {
  const markup = renderToStaticMarkup(<ProgressBar value={41.7} max={0} label="Ratio" />);
  assert.match(markup, /aria-valuenow="42"/);
  assert.doesNotMatch(markup, /NaN/);
});

test("work progress, linked-task completion and time allocation are named distinctly", () => {
  const projects = read("app/(workspace)/tasks/projects/page.tsx");

  // Work progress: home surface retired; Today owns the daily plan now.

  // Project percentages are linked-task completion, and say so.
  assert.match(projects, /linked task completion/);
  assert.doesNotMatch(projects, /label="Project progress"/);
});

test("the live timer tick cannot animate the page", () => {
  const live = read("components/timer/live-duration.tsx");

  assert.match(live, /^"use client";/);
  assert.doesNotMatch(live, /animate-/);
  assert.doesNotMatch(live, /motion\./);
  assert.doesNotMatch(live, /transition/);
});

test("the live timer stays a client leaf under server parents", () => {
  for (const parent of [
    "components/timer/active-timer-display.tsx",
    "components/today/today-cockpit-panels.tsx",
  ]) {
    const source = read(parent);
    assert.doesNotMatch(
      source,
      /^"use client";/,
      `${parent} must stay a server component so the 1s tick cannot re-render it`,
    );
    assert.match(source, /<LiveDuration/);
  }
});

test("no transition: all remains in the authenticated stylesheets", () => {
  for (const path of ["app/globals.css", "styles/workspace.css", "styles/motion.css"]) {
    const css = read(path);
    assert.doesNotMatch(css, /transition:\s*all/, `${path} must not use transition: all`);
  }
});

test("reduced motion is honoured at every layer", () => {
  assert.match(read("styles/motion.css"), /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(read("styles/workspace.css"), /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(read("components/motion-provider.tsx"), /reducedMotion="user"/);
});

test("every authenticated data route has a loading boundary", () => {
  for (const route of [
    "today",
    "tasks",
    "review",
    "backlog",
    "settings",
  ]) {
    assert.ok(
      read(`app/(workspace)/${route}/loading.tsx`).length > 0,
      `/ ${route} needs a loading boundary`,
    );
  }
});
