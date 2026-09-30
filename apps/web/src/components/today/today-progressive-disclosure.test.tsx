import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TodayIntelligencePanel } from "./today-intelligence-panel";
import { TodayOperatorPlan } from "./today-operator-plan";

test("TodayIntelligencePanel: renders progressive disclosure summary with Calm badge when no friction", () => {
  const html = renderToStaticMarkup(
    <TodayIntelligencePanel
      health={{
        data: null,
        recommendations: [],
        errorMessage: null,
      }}
      friction={{
        data: {
          blocked: [],
          staleTasks: [],
          staleGoals: [],
          estimateSignals: [],
          neglectedGoals: [],
          contextSwitch: { isFriction: false, switchCount: 0 },
          workloadImbalance: { isImbalance: false },
        } as any,
        errorMessage: null,
      }}
    />,
  );

  assert.match(html, /<details/);
  assert.match(html, /Workload &amp; friction diagnostics/);
  assert.match(html, /Calm/);
});

test("TodayIntelligencePanel: shows warning badge with signal count when friction is present", () => {
  const html = renderToStaticMarkup(
    <TodayIntelligencePanel
      health={{
        data: null,
        recommendations: [],
        errorMessage: null,
      }}
      friction={{
        data: {
          blocked: [{ id: "t1", title: "Blocked task" } as any],
          staleTasks: [],
          staleGoals: [],
          estimateSignals: [],
          neglectedGoals: [],
          contextSwitch: { isFriction: false, switchCount: 0 },
          workloadImbalance: { isImbalance: false },
        } as any,
        errorMessage: null,
      }}
    />,
  );

  assert.match(html, /1 signal/);
});

test("TodayOperatorPlan: renders progressive disclosure summary when no proposal exists", () => {
  const html = renderToStaticMarkup(
    <TodayOperatorPlan
      tasks={[]}
      proposal={null}
      proposalError={null}
      returnTo="/today"
    />,
  );

  assert.match(html, /<details/);
  assert.match(html, /\+ Prepare approval plan from focus lane\.\.\./);
});

test("TodayOperatorPlan: renders approval controls directly when proposal exists", () => {
  const html = renderToStaticMarkup(
    <TodayOperatorPlan
      tasks={[]}
      proposal={{
        id: "prop-1",
        ownerUserId: "u1",
        status: "generated",
        proposedTaskIds: [],
        createdAt: "2026-09-30T10:00:00Z",
        updatedAt: "2026-09-30T10:00:00Z",
      } as any}
      proposalError={null}
      returnTo="/today"
    />,
  );

  assert.match(html, /Needs approval/);
  assert.match(html, /Approve plan/);
});
