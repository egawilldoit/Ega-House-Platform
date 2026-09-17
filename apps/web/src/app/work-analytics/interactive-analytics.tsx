"use client";

import React from "react";
import { TrendBarChart } from "@/components/review/trend-bar-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDurationLabel } from "@/lib/task-session";
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

type ChartSectionProps = {
  series: WorkAnalyticsDaily[];
  title: string;
  dateDrilldownIndex: Record<string, DrilldownSessionDTO[]>;
  compact?: boolean;
};

function ChartSection({
  series,
  title,
  dateDrilldownIndex,
  compact = false,
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
    <TrendBarChart
      data={series}
      title={title}
      onBarClick={handleBarClick}
      compact={compact}
    />
  );
}

type BreakdownRowProps = {
  title: string;
  meta: string;
  workedMinutes: number;
  relativePercent: number;
  onClick: () => void;
};

function BreakdownRow({
  title,
  meta,
  workedMinutes,
  relativePercent,
  onClick,
}: BreakdownRowProps) {
  const width = workedMinutes > 0 ? Math.max(8, relativePercent) : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className="analytics-breakdown-row group"
    >
      <div className="analytics-breakdown-row-head">
        <span className="analytics-breakdown-row-title">{title}</span>
        <span className="analytics-breakdown-row-value">
          {formatDurationLabel(workedMinutes * 60)}
        </span>
      </div>
      <div className="analytics-breakdown-track" aria-hidden="true">
        <span style={{ width: `${width}%` }} />
      </div>
      <p className="analytics-breakdown-row-meta">{meta}</p>
    </button>
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

  if (breakdownBy === "goal") {
    const maxMinutes = Math.max(1, ...goalBreakdown.map((item) => item.workedMinutes));

    return (
      <Card className="analytics-breakdown-card">
        <CardHeader className="analytics-card-heading">
          <div>
            <p className="analytics-section-kicker">Allocation</p>
            <CardTitle className="text-base">{title}</CardTitle>
          </div>
          <p className="analytics-card-caption">Open any row for session detail</p>
        </CardHeader>
        <CardContent className="analytics-breakdown-list">
          {goalBreakdown.length === 0 ? (
            <div className="surface-empty px-4 py-5 text-sm text-[color:var(--muted-foreground)]">
              No goal data for this range.
            </div>
          ) : (
            goalBreakdown.map((item) => {
              const key = item.goalId ?? "__no-goal__";
              return (
                <BreakdownRow
                  key={key}
                  title={item.goalTitle}
                  meta={`${item.projectName} · ${item.sessionCount} session${item.sessionCount === 1 ? "" : "s"}`}
                  workedMinutes={item.workedMinutes}
                  relativePercent={Math.round((item.workedMinutes / maxMinutes) * 100)}
                  onClick={() =>
                    openDrilldown({
                      type: "goal",
                      label: item.goalTitle,
                      sessions: goalDrilldownIndex[key] ?? [],
                    })
                  }
                />
              );
            })
          )}
        </CardContent>
      </Card>
    );
  }

  if (breakdownBy === "task") {
    const maxMinutes = Math.max(1, ...taskBreakdown.map((item) => item.workedMinutes));

    return (
      <Card className="analytics-breakdown-card">
        <CardHeader className="analytics-card-heading">
          <div>
            <p className="analytics-section-kicker">Allocation</p>
            <CardTitle className="text-base">{title}</CardTitle>
          </div>
          <p className="analytics-card-caption">Open any row for session detail</p>
        </CardHeader>
        <CardContent className="analytics-breakdown-list">
          {taskBreakdown.length === 0 ? (
            <div className="surface-empty px-4 py-5 text-sm text-[color:var(--muted-foreground)]">
              No task data for this range.
            </div>
          ) : (
            taskBreakdown.map((item) => {
              const context =
                [item.projectName, item.goalTitle].filter(Boolean).join(" · ") ||
                "No project or goal";

              return (
                <BreakdownRow
                  key={item.taskId}
                  title={item.taskTitle}
                  meta={`${item.percentOfTotal}% of tracked · ${context}`}
                  workedMinutes={item.workedMinutes}
                  relativePercent={Math.round((item.workedMinutes / maxMinutes) * 100)}
                  onClick={() =>
                    openDrilldown({
                      type: "task",
                      label: item.taskTitle,
                      sessions: taskDrilldownIndex[item.taskId] ?? [],
                    })
                  }
                />
              );
            })
          )}
        </CardContent>
      </Card>
    );
  }

  const maxMinutes = Math.max(
    1,
    ...projectBreakdown.map((item) => item.workedMinutes),
  );

  return (
    <Card className="analytics-breakdown-card">
      <CardHeader className="analytics-card-heading">
        <div>
          <p className="analytics-section-kicker">Allocation</p>
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
        <p className="analytics-card-caption">Open any row for session detail</p>
      </CardHeader>
      <CardContent className="analytics-breakdown-list">
        {projectBreakdown.length === 0 ? (
          <div className="surface-empty px-4 py-5 text-sm text-[color:var(--muted-foreground)]">
            No project data for this range.
          </div>
        ) : (
          projectBreakdown.map((item) => {
            const key = item.projectId ?? "__unknown__";
            return (
              <BreakdownRow
                key={key}
                title={item.projectName}
                meta={`${item.sessionCount} session${item.sessionCount === 1 ? "" : "s"}`}
                workedMinutes={item.workedMinutes}
                relativePercent={Math.round((item.workedMinutes / maxMinutes) * 100)}
                onClick={() =>
                  openDrilldown({
                    type: "project",
                    label: item.projectName,
                    sessions: projectDrilldownIndex[key] ?? [],
                  })
                }
              />
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function formatInsightDate(value: string | null) {
  if (!value) return "n/a";
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

type InteractiveAnalyticsProps = {
  drilldownIndexes: DrilldownIndexes;
  primarySeries: WorkAnalyticsDaily[];
  primaryTitle: string;
  last7DaysSeries: WorkAnalyticsDaily[];
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
  primarySeries,
  primaryTitle,
  last7DaysSeries,
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
  const deltaLabel =
    insightsDeltaMinutes === 0
      ? "Even"
      : `${insightsDeltaMinutes > 0 ? "+" : "-"}${formatDurationLabel(
          Math.abs(insightsDeltaMinutes) * 60,
        )}`;

  return (
    <AnalyticsDrilldownProvider>
      <div className="analytics-visualization-stack">
        <div className="analytics-primary-chart">
          <ChartSection
            series={primarySeries}
            title={primaryTitle}
            dateDrilldownIndex={drilldownIndexes.date}
          />
        </div>

        <div className="analytics-secondary-grid" aria-label="Supporting analytics">
          <ChartSection
            series={last7DaysSeries}
            title="Recent rhythm · 7 days"
            dateDrilldownIndex={drilldownIndexes.date}
            compact
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

          <Card className="analytics-insights-card">
            <CardHeader className="analytics-card-heading">
              <div>
                <p className="analytics-section-kicker">Pattern</p>
                <CardTitle className="text-base">Insights</CardTitle>
              </div>
              <p className="analytics-card-caption">This week at a glance</p>
            </CardHeader>
            <CardContent>
              <dl className="analytics-insights-grid">
                <div>
                  <dt>Weekly delta</dt>
                  <dd
                    className={
                      insightsDeltaMinutes > 0
                        ? "text-signal-live"
                        : insightsDeltaMinutes < 0
                          ? "text-signal-error"
                          : ""
                    }
                  >
                    {deltaLabel}
                  </dd>
                </div>
                <div>
                  <dt>Best day</dt>
                  <dd>{formatInsightDate(insightsBestDay)}</dd>
                </div>
                <div>
                  <dt>Quietest day</dt>
                  <dd>{formatInsightDate(insightsLowestDay)}</dd>
                </div>
                <div>
                  <dt>Avg session</dt>
                  <dd>{formatDurationLabel(insightsAvgSessionMinutes * 60)}</dd>
                </div>
                <div className="analytics-insight-wide">
                  <dt>Longest session</dt>
                  <dd>{formatDurationLabel(insightsLongestSessionMinutes * 60)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>

      <AnalyticsDrilldownDrawer />
    </AnalyticsDrilldownProvider>
  );
}
