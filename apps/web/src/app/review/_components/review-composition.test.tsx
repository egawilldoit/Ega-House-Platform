import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ReviewPageView } from "./ReviewPageView";
import type { ReviewPageModel } from "../_lib/review-page-model";

const model = {
  weekOf: "2026-09-14",
  data: {
    bounds: { weekStart: "2026-09-14", weekEnd: "2026-09-20" },
    pastReviews: [
      {
        id: "review-1",
        week_start: "2026-09-07",
        week_end: "2026-09-13",
        summary: "Shipped the design system refactor.",
        created_at: "2026-09-13T17:00:00.000Z",
        updated_at: "2026-09-13T18:00:00.000Z",
      },
    ],
    selectedReview: null,
    weeklyStats: {
      tasksCreated: 3,
      sessionsLogged: 4,
      trackedSeconds: 7200,
      goalsTouched: 1,
      goalStatusCounts: [{ status: "active", count: 1 }],
      blockedTasks: [
        {
          id: "task-1",
          title: "Waiting on review",
          blockedReason: "Needs a decision",
          updatedAt: "2026-09-18T10:00:00.000Z",
        },
      ],
    },
    sessionHeatmap: [
      { date: "2026-09-14", trackedSeconds: 3600 },
      { date: "2026-09-15", trackedSeconds: 0 },
    ],
    mostTrackedInsights: {
      tasks: [
        {
          id: "task-1",
          label: "Ship the refactor",
          href: "/tasks/projects/alpha#task-task-1",
          trackedSeconds: 3600,
          trackedLabel: "1h",
          sessionCount: 1,
          detail: "Alpha",
        },
      ],
      projects: [],
      goals: [],
    },
    generatedDraft: {
      summary: "Generated summary",
      wins: "Generated wins",
      blockers: "Generated blockers",
      nextSteps: "Generated next steps",
    },
    reviewFormDefaults: {
      summary: "Generated summary",
      wins: "Generated wins",
      blockers: "Generated blockers",
      nextSteps: "Generated next steps",
      weekOf: "2026-09-14",
    },
  },
} as unknown as ReviewPageModel;

test("ReviewPageView renders the weekly review workspace", () => {
  const markup = renderToStaticMarkup(<ReviewPageView model={model} />);

  assert.match(markup, /Focused time/);
  assert.match(markup, /Sessions/);
  assert.match(markup, /Tasks created/);
  assert.match(markup, /Goals touched/);
  assert.match(markup, /Review status/);
  assert.match(markup, /Email Preview/);
  assert.match(markup, /Send current saved weekly review through Resend without changing official send state/);
  assert.match(markup, /Weekly review|Generated review draft/);
  assert.match(markup, /Most tracked this week/);
  assert.match(markup, /Activity Stream/);
  assert.match(markup, /Ship the refactor/);
  assert.match(markup, /Waiting on review/);
  assert.match(markup, /href="\/review\/review-1"/);
  assert.match(markup, /href="\/tasks\/task-1"/);
});

test("ReviewPageView keeps saved review editing and the regenerate href", () => {
  const savedModel = {
    ...model,
    data: {
      ...model.data,
      selectedReview: {
        id: "review-2",
        summary: "Saved summary",
        wins: "Saved wins",
        blockers: "Saved blockers",
        next_steps: "Saved next steps",
        created_at: "2026-09-19T09:00:00.000Z",
        updated_at: "2026-09-19T10:00:00.000Z",
      },
      reviewFormDefaults: {
        summary: "Saved summary",
        wins: "Saved wins",
        blockers: "Saved blockers",
        nextSteps: "Saved next steps",
        weekOf: "2026-09-14",
      },
    },
  } as unknown as ReviewPageModel;

  const markup = renderToStaticMarkup(<ReviewPageView model={savedModel} />);

  assert.match(markup, /Saved review/);
  assert.match(markup, /Saved content is loaded for editing/);
  assert.match(markup, /Regenerate/);
  assert.match(markup, /href="\/review\?weekOf=2026-09-14&amp;draft=generated"/);
  assert.match(markup, /reviewId="review-2"|value="review-2"/);
});
