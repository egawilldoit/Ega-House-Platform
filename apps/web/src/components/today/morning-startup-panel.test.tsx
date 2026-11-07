import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { MorningStartupModel } from "@/lib/morning-startup";

import { MorningStartupPanel } from "./morning-startup-panel";

function model(overrides: Partial<MorningStartupModel> = {}): MorningStartupModel {
  return {
    date: "2026-11-07",
    timezone: "Africa/Lagos",
    weekday: "saturday",
    workTargetMinutes: 240,
    workTargetLabel: "4h",
    isRestDay: false,
    paused: false,
    yesterday: {
      completedCount: 2,
      tasks: [
        {
          id: "y1",
          title: "Ship review",
          projectName: "Alpha",
          projectSlug: "alpha",
          completedAt: "2026-11-06T18:00:00.000Z",
        },
        {
          id: "y2",
          title: "Fix CI",
          projectName: "Beta",
          projectSlug: "beta",
          completedAt: "2026-11-06T17:00:00.000Z",
        },
      ],
      errorMessage: null,
    },
    carryovers: {
      count: 1,
      tasks: [
        {
          id: "c1",
          title: "Carry the launch",
          projectName: "Alpha",
          projectSlug: "alpha",
          status: "in_progress",
        },
      ],
    },
    groups: [
      {
        key: "alpha",
        projectName: "Alpha",
        projectSlug: "alpha",
        isPrimary: true,
        tasks: [
          {
            id: "a1",
            title: "Alpha one",
            projectName: "Alpha",
            projectSlug: "alpha",
            estimateMinutes: 60,
            status: "todo",
            isPlannedForToday: false,
          },
          {
            id: "a2",
            title: "Alpha two",
            projectName: "Alpha",
            projectSlug: "alpha",
            estimateMinutes: null,
            status: "todo",
            isPlannedForToday: false,
          },
        ],
      },
      {
        key: "beta",
        projectName: "Beta",
        projectSlug: "beta",
        isPrimary: false,
        tasks: [
          {
            id: "b1",
            title: "Beta one",
            projectName: "Beta",
            projectSlug: "beta",
            estimateMinutes: 30,
            status: "todo",
            isPlannedForToday: false,
          },
        ],
      },
    ],
    selectedOutcomeIds: ["a1"],
    selectedOutcomes: [
      {
        id: "a1",
        title: "Alpha one",
        projectName: "Alpha",
        projectSlug: "alpha",
      },
    ],
    primaryProject: { key: "alpha", projectName: "Alpha", projectSlug: "alpha" },
    skipped: false,
    ...overrides,
  };
}

test("renders yesterday completed work, carryovers and the configured work target", () => {
  const markup = renderToStaticMarkup(<MorningStartupPanel model={model()} />);

  assert.match(markup, /Today&#x27;s work target:/);
  assert.match(markup, /4h/);
  assert.match(markup, /data-testid="morning-startup-yesterday-count"[^>]*>2 tasks completed/);
  assert.match(markup, /Ship review/);
  assert.match(markup, /Fix CI/);
  assert.match(markup, /data-testid="morning-startup-carryover-count"[^>]*>1 task carried into today/);
  assert.match(markup, /Carry the launch/);
  assert.match(markup, /Planned for today \(1\)/);
  assert.match(markup, /Alpha one/);
});

test("renders one form per candidate project with 1-3 task checkboxes", () => {
  const markup = renderToStaticMarkup(<MorningStartupPanel model={model()} />);

  assert.equal((markup.match(/<form/g) ?? []).length, 2);
  assert.equal((markup.match(/type="checkbox"/g) ?? []).length, 3);
  assert.equal((markup.match(/name="taskIds"/g) ?? []).length, 3);
  assert.match(markup, /Start with Alpha/);
  assert.match(markup, /Start with Beta/);
  assert.match(markup, /<fieldset/);
  assert.match(markup, /<legend[^>]*>Alpha/);
});

test("renders a Skip link to ephemeral skipped state", () => {
  const markup = renderToStaticMarkup(<MorningStartupPanel model={model()} />);

  assert.match(markup, /data-testid="morning-startup-skip"/);
  assert.match(markup, /href="\/today\?startup=skipped"/);
});

test("renders a compact skipped card with a Resume link", () => {
  const markup = renderToStaticMarkup(
    <MorningStartupPanel model={model({ skipped: true })} />,
  );

  assert.match(markup, /data-testid="morning-startup-skipped"/);
  assert.match(markup, /Startup skipped/);
  assert.match(markup, /data-testid="morning-startup-resume"/);
  assert.match(markup, /href="\/today"/);
  assert.match(markup, /Resume startup/);
  assert.doesNotMatch(markup, /type="checkbox"/);
});

test("renders an empty state that links to Tasks when no candidates exist", () => {
  const markup = renderToStaticMarkup(
    <MorningStartupPanel model={model({ groups: [], selectedOutcomes: [], selectedOutcomeIds: [] })} />,
  );

  assert.match(markup, /No outcome tasks ready/);
  assert.match(markup, /href="\/tasks"/);
  assert.doesNotMatch(markup, /type="checkbox"/);
});

test("renders an inline unavailable note when the yesterday read failed", () => {
  const markup = renderToStaticMarkup(
    <MorningStartupPanel
      model={model({
        yesterday: {
          completedCount: 0,
          tasks: [],
          errorMessage: "Yesterday's completed work is unavailable right now.",
        },
      })}
    />,
  );

  assert.match(markup, /data-testid="morning-startup-yesterday-error"/);
  assert.match(markup, /Yesterday&#x27;s completed work is unavailable right now\./);
  assert.doesNotMatch(markup, /data-testid="morning-startup-yesterday-count"/);
});

test("never renders success text from the panel itself", () => {
  const markup = renderToStaticMarkup(<MorningStartupPanel model={model()} />);

  assert.doesNotMatch(markup, /Morning startup saved/i);
  assert.doesNotMatch(markup, /actionSuccess/i);
});

test("uses unique ids and accessible checkbox labels", () => {
  const markup = renderToStaticMarkup(<MorningStartupPanel model={model()} />);
  const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);

  assert.equal(new Set(ids).size, ids.length);
  assert.match(markup, /for="morning-startup-task-a1"/);
  assert.match(markup, /id="morning-startup-task-a1"/);
  assert.match(markup, /aria-describedby="morning-startup-group-0-help"/);
  assert.match(markup, /id="morning-startup-group-0-help"/);
  assert.match(markup, /name="returnTo" value="\/today"/);
});

test("renders rest-day and paused copy without relying on colour", () => {
  const restDayMarkup = renderToStaticMarkup(
    <MorningStartupPanel
      model={model({ isRestDay: true, workTargetMinutes: 0, workTargetLabel: "No work target" })}
    />,
  );
  assert.match(restDayMarkup, /Rest day: no work target is configured for saturday\./);

  const pausedMarkup = renderToStaticMarkup(<MorningStartupPanel model={model({ paused: true })} />);
  assert.match(pausedMarkup, /Personal schedule is paused; the target above is informational\./);
});
