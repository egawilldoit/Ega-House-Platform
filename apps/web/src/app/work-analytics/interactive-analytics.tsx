"use client";

import React from "react";
import { TrendBarChart } from "@/components/review/trend-bar-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AnalyticsDrilldownProvider,
  useAnalyticsDrilldown,
} from "./analytics-drilldown-context";
import { AnalyticsDrilldownDrawer } from "./analytics-drilldown-drawer";

import type {
  WorkAnalyticsDaily,
  WorkAnalyticsProjectBreakdown,
  WorkAnalyticsGoalBreakdown,
  WorkAnalyticsTaskBreakdown,
  DrilldownSessionDTO,
  DrilldownIndexes,
} from "@/lib/services/work-analytics-service";

// ---- Render props types for drilldown ----

type ChartSectionProps = {
  last7DaysSeries: WorkAnalyticsDaily[];
  last30DaysSeries: WorkAnalyticsDaily[];
  dateDrilldownIndex: Record<string, DrilldownSessionDTO[]>;
};

function ChartSection({
  last7DaysSeries,
  last30DaysSeries,
  dateDrilldownIndex,
}: ChartSectionProps) {
  const { openDrilldown } = useAnalyticsDrilldown();

  const handleBarClick = React.useCallback(
    (date: string, label: string) => {
      const sessions = dateDrilldownIndex[date] ?? [];
      openDrilldown({ type: "date", label, sessions });
    },
    [dateDrilldownIndex, openDrilldown],
  );

  return (
    <>
      <TrendBarChart
        data={last7DaysSeries}
        title="Last 7 days"
        onBarClick={handleBarClick}
      />
      <TrendBarChart
        data={last30DaysSeries}
        title="Last 30 days"
        onBarClick={handleBarClick}
      />
    </>
  );
}

type BreakdownCardProps = {
  title: string;
  breakdownBy: string;
  projectBreakdown: WorkAnalyticsProjectBreakdown[];
  goalBreakdown: WorkAnalyticsGoalBreakdown[];
  taskBreakdown: WorkAnalyticsTaskBreakdown[];
  projectDrilldownIndex: Record<string, DrilldownSessionDTO[]>;
  goalDrilldownIndex: Record<string, DrilldownSessionDTO[]>;
  taskDrilldownIndex: Record<string, DrilldownSessionDTO[]>;
};

function BreakdownCard({
  title,
  breakdownBy,
  projectBreakdown,
  goalBreakdown,
  taskBreakdown,
  projectDrilldownIndex,
  goalDrilldownIndex,
  taskDrilldownIndex,
}: BreakdownCardProps) {
  const { openDrilldown } = useAnalyticsDrilldown();

  const handleProjectClick = React.useCallback(
    (pb: WorkAnalyticsProjectBreakdown) => {
      const key = pb.projectId ?? "__unknown__";
      const sessions = projectDrilldownIndex[key] ?? [];
      openDrilldown({
        type: "project",
        label: pb.projectName,
        sessions,
      });
    },
    [projectDrilldownIndex, openDrilldown],
  );

  const handleGoalClick = React.useCallback(
    (gb: WorkAnalyticsGoalBreakdown) => {
      const key = gb.goalId ?? "__no-goal__";
      const sessions = goalDrilldownIndex[key] ?? [];
      openDrilldown({
        type: "goal",
        label: gb.goalTitle,
        sessions,
      });
    },
    [goalDrilldownIndex, openDrilldown],
  );

  const handleTaskClick = React.useCallback(
    (tb: WorkAnalyticsTaskBreakdown) => {
      const sessions = taskDrilldownIndex[tb.taskId] ?? [];
      openDrilldown({
        type: "task",
        label: tb.taskTitle,
        sessions,
      });
    },
    [taskDrilldownIndex, openDrilldown],
  );

  if (breakdownBy === "goal") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          {goalBreakdown.length === 0 ? (
            "No goal data"
          ) : (
            <div className="space-y-2">
              {goalBreakdown.map((gb) => (
                <button
                  key={gb.goalId ?? "__no-goal__"}
                  type="button"
                  onClick={() => handleGoalClick(gb)}
                  className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--accent-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--signal-live)]"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-[color:var(--foreground)]">
                      {gb.goalTitle}
                    </span>
                    <span className="text-sm text-[color:var(--muted-foreground)]">
                      {gb.workedMinutes}m
                    </span>
                  </div>
                  <div className="text-xs text-[color:var(--muted-foreground)]">
                    {gb.projectName} · {gb.sessionCount} sessions
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  if (breakdownBy === "task") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          {taskBreakdown.length === 0 ? (
            "No task data"
          ) : (
            <div className="space-y-2">
              {taskBreakdown.map((tb) => (
                <button
                  key={tb.taskId}
                  type="button"
                  onClick={() => handleTaskClick(tb)}
                  className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--accent-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--signal-live)]"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-[color:var(--foreground)]">
                      {tb.taskTitle}
                    </span>
                    <span className="text-sm text-[color:var(--muted-foreground)]">
                      {tb.workedMinutes}m ({tb.percentOfTotal}%)
                    </span>
                  </div>
                  <div className="text-xs text-[color:var(--muted-foreground)]">
                    {[tb.projectName, tb.goalTitle]
                      .filter(Boolean)
                      .join(" · ") || "No context"}
                    {" · "}
                    {tb.sessionCount} session{tb.sessionCount !== 1 ? "s" : ""}
                    {tb.estimateMinutes != null
                      ? ` · est ${tb.estimateMinutes}m`
                      : ""}
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Default: project breakdown
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {projectBreakdown.length === 0 ? (
          "No project data"
        ) : (
          <div className="space-y-2">
            {projectBreakdown.map((pb) => (
              <button
                key={pb.projectId ?? "__unknown__"}
                type="button"
                onClick={() => handleProjectClick(pb)}
                className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--accent-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--signal-live)]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-[color:var(--foreground)]">
                    {pb.projectName}
                  </span>
                  <span className="text-sm text-[color:var(--muted-foreground)]">
                    {pb.workedMinutes}m
                  </span>
                </div>
                <div className="text-xs text-[color:var(--muted-foreground)]">
                  {pb.sessionCount} sessions
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Main interactive wrapper ----

type InteractiveAnalyticsProps = {
  drilldownIndexes: DrilldownIndexes;
  last7DaysSeries: WorkAnalyticsDaily[];
  last30DaysSeries: WorkAnalyticsDaily[];
  breakdownBy: string;
  breakdownTitle: string;
  projectBreakdown: WorkAnalyticsProjectBreakdown[];
  goalBreakdown: WorkAnalyticsGoalBreakdown[];
  taskBreakdown: WorkAnalyticsTaskBreakdown[];
  insightsDeltaMinutes: number;
  insightsBestDay: string | null;
  insightsLowestDay: string | null;
  insightsAvgSessionMinutes: number;
  insightsLongestSessionMinutes: number;
};

export function InteractiveAnalytics({
  drilldownIndexes,
  last7DaysSeries,
  last30DaysSeries,
  breakdownBy,
  breakdownTitle,
  projectBreakdown,
  goalBreakdown,
  taskBreakdown,
  insightsDeltaMinutes,
  insightsBestDay,
  insightsLowestDay,
  insightsAvgSessionMinutes,
  insightsLongestSessionMinutes,
}: InteractiveAnalyticsProps) {
  return (
    <AnalyticsDrilldownProvider>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartSection
          last7DaysSeries={last7DaysSeries}
          last30DaysSeries={last30DaysSeries}
          dateDrilldownIndex={drilldownIndexes.date}
        />
        <BreakdownCard
          title={breakdownTitle}
          breakdownBy={breakdownBy}
          projectBreakdown={projectBreakdown}
          goalBreakdown={goalBreakdown}
          taskBreakdown={taskBreakdown}
          projectDrilldownIndex={drilldownIndexes.project}
          goalDrilldownIndex={drilldownIndexes.goal}
          taskDrilldownIndex={drilldownIndexes.task}
        />
        <Card>
          <CardHeader>
            <CardTitle>Insights</CardTitle>
          </CardHeader>
          <CardContent>
            Delta {insightsDeltaMinutes}m · Best{" "}
            {insightsBestDay ?? "n/a"} · Lowest{" "}
            {insightsLowestDay ?? "n/a"} · Avg{" "}
            {insightsAvgSessionMinutes}m · Longest{" "}
            {insightsLongestSessionMinutes}m
          </CardContent>
        </Card>
      </div>
      <AnalyticsDrilldownDrawer />
    </AnalyticsDrilldownProvider>
  );
}
