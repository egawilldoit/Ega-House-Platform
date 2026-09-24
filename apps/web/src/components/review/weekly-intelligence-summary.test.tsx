import { describe, expect, it } from "vitest";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WeeklyIntelligenceSummary } from "./weekly-intelligence-summary";

type SummaryProps = ComponentProps<typeof WeeklyIntelligenceSummary>;

const health = {
  data: {
    quality: {
      quality: "sufficient",
      reasons: [],
      hasOpenSessions: false,
      openSessionCount: 0,
      malformedCount: 0,
      sessionCount: 9,
      totalTrackedSeconds: 59100,
    },
    rollingWorkload: {
      totalTrackedSeconds: 59100,
      totalTrackedMinutes: 985,
      totalTrackedLabel: "16h 25m 0s",
    },
  },
  recommendations: [
    {
      id: "health.recommendation.recovery_high_workload",
      kind: "recovery",
      severity: "guide",
      copyKey: "health.recommendation.recovery_high_workload",
      title: "Steady workload this week",
      message:
        "Tracked workload was 985 min over the last 7 days — consider spacing demanding sessions and planning lighter blocks to keep pace sustainable. Based on 985 min tracked (threshold 900 min).",
      evidence: {
        metric: "rollingWorkload.totalTrackedMinutes",
        value: 985,
        threshold: 900,
        unit: "minutes",
        label: "985 min in 7d",
        windowDays: 7,
        quality: "sufficient",
      },
    },
  ],
  errorMessage: null,
};

const friction = {
  data: {
    ok: true,
    generatedAt: "2026-09-20T12:00:00.000Z",
    thresholdDays: 7,
    blocked: [],
    staleTasks: [],
    staleGoals: [],
    estimateSignals: [
      {
        id: "task-1",
        title: "Ship the refactor",
        projectId: "p1",
        goalId: null,
        estimateMinutes: 10,
        actualMinutes: 95,
        deltaMinutes: 85,
        percentError: 850,
        severity: "high",
        status: "over",
      },
    ],
    contextSwitch: {
      switchCount: 0,
      threshold: 6,
      highThreshold: 10,
      severity: "none",
      isFriction: false,
      transitionsCount: 0,
      distinctTaskCount: 0,
      window: { startIso: "2026-09-14T00:00:00.000Z", endIso: "2026-09-21T00:00:00.000Z" },
    },
    neglectedGoals: [],
    workloadImbalance: {
      isImbalance: false,
      severity: "none",
      totalTrackedSeconds: 0,
      totalTrackedMinutes: 0,
      projectCount: 0,
      dominantProjectId: null,
      dominantProjectName: null,
      dominantTrackedSeconds: 0,
      dominantSharePercent: 0,
      threshold: 60,
      highThreshold: 75,
      minTotalMinutes: 120,
      minForHighMinutes: 240,
      window: { startIso: "2026-09-14T00:00:00.000Z", endIso: "2026-09-21T00:00:00.000Z" },
    },
    evidenceWindow: { startIso: "2026-09-14T00:00:00.000Z", endIso: "2026-09-21T00:00:00.000Z" },
  },
  errorMessage: null,
};

describe("WeeklyIntelligenceSummary display policy", () => {
  it("renders the health card as product guidance without rule-engine internals", () => {
    const markup = renderToStaticMarkup(
      <WeeklyIntelligenceSummary
        health={health as unknown as SummaryProps["health"]}
        friction={friction as unknown as SummaryProps["friction"]}
      />,
    );

    expect(markup).toContain("Enough data");
    expect(markup).toContain("16h 25m tracked this week");
    expect(markup).toContain("Steady workload this week.");
    expect(markup).toContain(
      "Consider spacing demanding sessions and planning lighter blocks to keep pace sustainable.",
    );
    expect(markup).not.toContain("Evidence ready");
    expect(markup).not.toContain("threshold");
    expect(markup).not.toContain("985 min");
    expect(markup).not.toContain("Operator recommendation");
  });

  it("leads the estimate signal with a ratio, keeps the absolute, and demotes the percentage", () => {
    const markup = renderToStaticMarkup(
      <WeeklyIntelligenceSummary
        health={health as unknown as SummaryProps["health"]}
        friction={friction as unknown as SummaryProps["friction"]}
      />,
    );

    const ratioIndex = markup.indexOf("9.5× its estimate");
    const absoluteIndex = markup.indexOf("+1h 25m");
    const percentIndex = markup.indexOf("+850% variance");

    expect(ratioIndex).toBeGreaterThan(-1);
    expect(absoluteIndex).toBeGreaterThan(-1);
    expect(percentIndex).toBeGreaterThan(-1);
    expect(ratioIndex).toBeLessThan(absoluteIndex);
    expect(absoluteIndex).toBeLessThan(percentIndex);
    expect(markup).not.toContain("850% over estimate");
  });

  it("labels the friction advice as a recommendation in human language", () => {
    const markup = renderToStaticMarkup(
      <WeeklyIntelligenceSummary
        health={health as unknown as SummaryProps["health"]}
        friction={friction as unknown as SummaryProps["friction"]}
      />,
    );

    expect(markup).toContain("Recommendation");
    expect(markup).toContain("Protect one clear next step for the coming week.");
    expect(markup).not.toContain("OPERATOR");
    expect(markup).not.toContain("protect one clear next step");
  });
});
