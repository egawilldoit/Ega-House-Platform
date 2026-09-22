import { Clock3, Hourglass, Target, Timer } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { MetricDelta } from "@/components/ui/metric";
import { StatCard } from "@/components/ui/stat-card";
import { formatDurationLabel } from "@/lib/task-session";
import { InteractiveAnalytics } from "../interactive-analytics";
import type { WorkAnalyticsPageModel } from "../_lib/work-analytics-page-model";

function signedPercent(value: number | null) {
  if (value === null) return "--";
  return `${value >= 0 ? "+" : ""}${value}%`;
}

function signedDuration(minutes: number) {
  return `${minutes >= 0 ? "+" : "-"}${formatDurationLabel(Math.abs(minutes) * 60)}`;
}

function formatMinutes(minutes: number) {
  return formatDurationLabel(minutes * 60);
}

function ContextStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[length:var(--text-meta)] text-ega-text-secondary">{label}</dt>
      <dd className="break-words tabular-nums text-[length:var(--text-body)] font-medium text-ega-text">
        {value}
      </dd>
    </div>
  );
}

export function WorkAnalyticsPageView({ model }: { model: WorkAnalyticsPageModel }) {
  if (model.error || !model.report) {
    return <div className="p-6">{model.error ?? "Failed to load work analytics data."}</div>;
  }
  const report = model.report;
  const tasksWithEstimates =
    report.estimateAccuracy.overCount +
    report.estimateAccuracy.underCount +
    report.estimateAccuracy.exactCount;
  const weekDelta = report.thisWeekInsights;
  const groupBy = model.filters?.groupBy ?? "day";

  const weekChangeLabel =
    weekDelta.percentChange === null
      ? "No prior 7-day data"
      : `${signedPercent(weekDelta.percentChange)} · ${signedDuration(weekDelta.deltaMinutes)}`;

  return (
    <div className="flex flex-col gap-6" data-testid="work-analytics-workspace">
      <DashboardSection
        title="Execution overview"
        description={`Focused time, session volume, and estimate accuracy for ${report.selectedRangeLabel}.`}
      >
        <div className="kpi-grid">
          <StatCard
            data-testid="analytics-kpi-focused-time"
            label="Focused time"
            icon={Clock3}
            value={formatMinutes(report.selectedSummary.workedMinutes)}
            trend={
              weekDelta.percentChange === null ? undefined : (
                <MetricDelta
                  value={signedPercent(weekDelta.percentChange)}
                  direction={weekDelta.deltaMinutes >= 0 ? "up" : "down"}
                  label="vs prior 7d"
                />
              )
            }
            subtitle={`${report.selectedRangeLabel} · ${report.selectedSummary.activeDays} active days`}
          />
          <StatCard
            data-testid="analytics-kpi-sessions"
            label="Sessions"
            icon={Timer}
            value={report.selectedSummary.sessionCount}
            subtitle={`Avg ${formatMinutes(
              report.selectedSummary.averageWorkPerActiveDayMinutes,
            )} per active day`}
          />
          <StatCard
            data-testid="analytics-kpi-average-session"
            label="Average session"
            icon={Hourglass}
            value={formatMinutes(report.selectedSummary.averageSessionLengthMinutes)}
            subtitle={`per session · ${report.selectedRangeLabel}`}
          />
          <StatCard
            data-testid="analytics-kpi-estimate-accuracy"
            label="Estimate accuracy"
            icon={Target}
            value={signedPercent(report.estimateAccuracy.estimateDeltaPercent)}
            trend={
              <MetricDelta
                value={signedDuration(report.estimateAccuracy.estimateDeltaMinutes)}
                direction={
                  report.estimateAccuracy.estimateDeltaMinutes > 0
                    ? "up"
                    : report.estimateAccuracy.estimateDeltaMinutes < 0
                      ? "down"
                      : "flat"
                }
                higherIsBetter={false}
                label="tracked vs estimate"
              />
            }
            subtitle={`No estimate on ${report.estimateAccuracy.noEstimateCount} tasks`}
          />
        </div>
      </DashboardSection>

      <InteractiveAnalytics
        drilldownIndexes={report.drilldownIndexes}
        recentDateDrilldownIndex={report.recentDateDrilldownIndex}
        trendDateDrilldownIndex={report.trendDateDrilldownIndex}
        primarySeries={report.selectedSeries}
        primaryTitle={`Focus time — ${report.selectedRangeLabel}`}
        last7DaysSeries={report.last7DaysSeries}
        last30DaysSeries={report.last30DaysSeries}
        breakdownBy={report.breakdownBy}
        breakdownTitle={report.breakdownTitle}
        projectBreakdown={report.projectBreakdown}
        goalBreakdown={report.goalBreakdown}
        taskBreakdown={report.taskBreakdown}
        selectedRangeLabel={report.selectedRangeLabel}
        groupBy={groupBy}
      >
        <DashboardSection
          title="Accuracy and context"
          description="How tracking compares with estimates, and the windows these numbers come from."
        >
          <div className="grid gap-4 lg:grid-cols-3">
            <Card label="Estimate accuracy" title="Tracked vs estimated">
              <CardContent className="flex flex-col gap-4" data-testid="analytics-accuracy">
                <div className="grid grid-cols-2 gap-4">
                  <div className="min-w-0">
                    <p className="metric-label">Estimated</p>
                    <p className="metric-value">
                      {formatMinutes(report.estimateAccuracy.totalEstimatedMinutes)}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="metric-label">Tracked</p>
                    <p className="metric-value">
                      {formatMinutes(report.estimateAccuracy.totalTrackedMinutes)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <MetricDelta
                    value={signedPercent(report.estimateAccuracy.estimateDeltaPercent)}
                    direction={
                      report.estimateAccuracy.estimateDeltaMinutes > 0
                        ? "up"
                        : report.estimateAccuracy.estimateDeltaMinutes < 0
                          ? "down"
                          : "flat"
                    }
                    higherIsBetter={false}
                    label="vs estimate"
                  />
                  <span className="text-[length:var(--text-meta)] text-ega-text-tertiary">
                    {signedDuration(report.estimateAccuracy.estimateDeltaMinutes)}
                  </span>
                </div>
                <p className="text-[length:var(--text-meta)] leading-[var(--leading-snug)] text-ega-text-secondary">
                  Tasks with estimates {tasksWithEstimates} ({report.estimateAccuracy.overCount} over,{" "}
                  {report.estimateAccuracy.underCount} under, {report.estimateAccuracy.exactCount}{" "}
                  exact) · No estimate {report.estimateAccuracy.noEstimateCount}
                </p>
              </CardContent>
            </Card>

            <Card label="Insights" title="Last 7 days at a glance">
              <CardContent>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <ContextStat label="Change vs prior 7 days" value={weekChangeLabel} />
                  <ContextStat
                    label="Best day"
                    value={
                      weekDelta.bestDay
                        ? `${weekDelta.bestDay.date} · ${formatMinutes(weekDelta.bestDay.workedMinutes)}`
                        : "—"
                    }
                  />
                  <ContextStat
                    label="Lowest tracked day"
                    value={
                      weekDelta.lowestNonZeroDay
                        ? `${weekDelta.lowestNonZeroDay.date} · ${formatMinutes(
                            weekDelta.lowestNonZeroDay.workedMinutes,
                          )}`
                        : "—"
                    }
                  />
                  <ContextStat
                    label="Average session"
                    value={formatMinutes(weekDelta.averageSessionLength)}
                  />
                  <ContextStat
                    label="Longest session"
                    value={formatMinutes(weekDelta.longestSession)}
                  />
                  <ContextStat label="Streak" value={`${weekDelta.currentStreak} days`} />
                </dl>
              </CardContent>
            </Card>

            <Card label="Context" title="Windows and months">
              <CardContent>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3" data-testid="analytics-context">
                  <ContextStat
                    label="Today"
                    value={`${formatMinutes(report.summary.todayWorkedMinutes)} · ${
                      report.summary.todaySessionCount
                    } sessions`}
                  />
                  <ContextStat
                    label="Yesterday"
                    value={`${formatMinutes(report.yesterday.workedMinutes)} · ${
                      report.yesterday.sessionCount
                    } sessions`}
                  />
                  <ContextStat
                    label="Last 7 days"
                    value={`${formatMinutes(report.summary.last7DaysWorkedMinutes)} · ${
                      report.summary.last7DaysSessionCount
                    } sessions`}
                  />
                  <ContextStat
                    label="Last 30 days"
                    value={`${formatMinutes(report.summary.last30DaysWorkedMinutes)} · ${
                      report.summary.last30DaysSessionCount
                    } sessions`}
                  />
                  <ContextStat
                    label="Avg session"
                    value={formatMinutes(report.summary.averageSessionLengthMinutes)}
                  />
                  <ContextStat
                    label="Month-to-date"
                    value={`${formatMinutes(report.monthComparison.currentMonthMinutes)} · ${
                      report.monthComparison.currentMonthSessionCount
                    } sessions`}
                  />
                  <ContextStat
                    label="Previous month"
                    value={`${formatMinutes(report.monthComparison.previousMonthMinutes)} · ${
                      report.monthComparison.previousMonthSessionCount
                    } sessions`}
                  />
                  <ContextStat
                    label="MoM delta"
                    value={`${signedPercent(report.monthComparison.percentChange)}${
                      report.monthComparison.hasPreviousData
                        ? ` · ${signedDuration(report.monthComparison.deltaMinutes)} vs prev`
                        : " · no previous month data"
                    }`}
                  />
                  <ContextStat
                    label="Avg active day"
                    value={`${formatMinutes(
                      report.monthComparison.currentMonthAvgPerActiveDayMinutes,
                    )} (${report.monthComparison.currentMonthActiveDays} days)`}
                  />
                  <ContextStat
                    label="Selected range"
                    value={`${formatMinutes(report.selectedSummary.workedMinutes)} · ${
                      report.selectedSummary.sessionCount
                    } sessions`}
                  />
                </dl>
              </CardContent>
            </Card>
          </div>
        </DashboardSection>
      </InteractiveAnalytics>
    </div>
  );
}
