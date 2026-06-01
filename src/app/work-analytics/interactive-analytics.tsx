"use client";

import React from "react";
import { TrendBarChart } from "@/components/review/trend-bar-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AnalyticsDrilldownProvider,
  useAnalyticsDrilldown,
} from "./analytics-drilldown-context";
import { AnalyticsDrilldownDrawer } from "./analytics-drilldown-drawer";

import type { ExecutionEvidenceSessionRow } from "@/lib/services/execution-evidence-service";
import type {
  WorkAnalyticsDaily,
  WorkAnalyticsProjectBreakdown,
  WorkAnalyticsGoalBreakdown,
  WorkAnalyticsTaskBreakdown,
} from "@/lib/services/work-analytics-service";

/**
 * Filters sessions that start on a given date (YYYY-MM-DD).
 * A session is considered active on a date if any part of it overlaps that calendar day.
 */
function filterSessionsByDate(
  sessions: ExecutionEvidenceSessionRow[],
  dateStr: string,
): ExecutionEvidenceSessionRow[] {
  const dayStart = new Date(`${dateStr}T00:00:00.000Z`).getTime();
  const dayEnd = dayStart + 86_400_000; // 24 hours in ms

  return sessions.filter((s) => {
    const sStart = new Date(s.started_at).getTime();
    const sEnd = s.ended_at
      ? new Date(s.ended_at).getTime()
      : Date.now();
    // Overlap: session started before day ends AND session ended after day starts
    return sStart < dayEnd && sEnd > dayStart;
  });
}

function filterSessionsByProject(
  sessions: ExecutionEvidenceSessionRow[],
  projectId: string | null,
): ExecutionEvidenceSessionRow[] {
  return sessions.filter((s) => {
    const id = s.tasks?.projects?.id ?? s.tasks?.project_id ?? null;
    if (projectId === null) {
      return id === null;
    }
    return id === projectId;
  });
}

function filterSessionsByGoal(
  sessions: ExecutionEvidenceSessionRow[],
  goalId: string | null,
): ExecutionEvidenceSessionRow[] {
  return sessions.filter((s) => {
    const id = s.tasks?.goals?.id ?? null;
    if (goalId === null) {
      return id === null;
    }
    return id === goalId;
  });
}

function filterSessionsByTask(
  sessions: ExecutionEvidenceSessionRow[],
  taskId: string,
): ExecutionEvidenceSessionRow[] {
  return sessions.filter((s) => {
    const id = s.tasks?.id ?? s.task_id;
    return id === taskId;
  });
}

// ---- Render props types for drilldown ----

type ChartSectionProps = {
  last7DaysSeries: WorkAnalyticsDaily[];
  last30DaysSeries: WorkAnalyticsDaily[];
  allSessions: ExecutionEvidenceSessionRow[];
};

function ChartSection({
  last7DaysSeries,
  last30DaysSeries,
  allSessions,
}: ChartSectionProps) {
  const { openDrilldown } = useAnalyticsDrilldown();

  const handleBarClick = React.useCallback(
    (date: string, label: string) => {
      const sessions = filterSessionsByDate(allSessions, date);
      openDrilldown({ type: "date", label, sessions });
    },
    [allSessions, openDrilldown],
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
  allSessions: ExecutionEvidenceSessionRow[];
};

function BreakdownCard({
  title,
  breakdownBy,
  projectBreakdown,
  goalBreakdown,
  taskBreakdown,
  allSessions,
}: BreakdownCardProps) {
  const { openDrilldown } = useAnalyticsDrilldown();

  const handleProjectClick = React.useCallback(
    (pb: WorkAnalyticsProjectBreakdown) => {
      const sessions = filterSessionsByProject(
        allSessions,
        pb.projectId,
      );
      openDrilldown({
        type: "project",
        label: pb.projectName,
        sessions,
      });
    },
    [allSessions, openDrilldown],
  );

  const handleGoalClick = React.useCallback(
    (gb: WorkAnalyticsGoalBreakdown) => {
      const sessions = filterSessionsByGoal(
        allSessions,
        gb.goalId,
      );
      openDrilldown({
        type: "goal",
        label: gb.goalTitle,
        sessions,
      });
    },
    [allSessions, openDrilldown],
  );

  const handleTaskClick = React.useCallback(
    (tb: WorkAnalyticsTaskBreakdown) => {
      const sessions = filterSessionsByTask(allSessions, tb.taskId);
      openDrilldown({
        type: "task",
        label: tb.taskTitle,
        sessions,
      });
    },
    [allSessions, openDrilldown],
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
  allSessions: ExecutionEvidenceSessionRow[];
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
  allSessions,
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
          allSessions={allSessions}
        />
        <BreakdownCard
          title={breakdownTitle}
          breakdownBy={breakdownBy}
          projectBreakdown={projectBreakdown}
          goalBreakdown={goalBreakdown}
          taskBreakdown={taskBreakdown}
          allSessions={allSessions}
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
