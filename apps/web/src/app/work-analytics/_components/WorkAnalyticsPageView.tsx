import Link from "next/link";
import { Clock3, Hourglass, Target, Timer } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { MetricDelta } from "@/components/ui/metric";
import { StatCard } from "@/components/ui/stat-card";
import {
  DISPLAY_EMPTY,
  formatDisplayDuration,
  formatDisplayDurationDelta,
  formatDisplayMultiple,
  formatDisplayPercent,
} from "@/lib/presentation-format";
import { InteractiveAnalytics } from "../interactive-analytics";
import type { WorkAnalyticsPageModel } from "../_lib/work-analytics-page-model";

function signedPercent(value: number | null) {
  return formatDisplayPercent(value, { signed: true });
}

function signedDuration(minutes: number) {
  return formatDisplayDurationDelta(minutes * 60, "minute");
}

function formatMinutes(minutes: number) {
  return formatDisplayDuration(minutes * 60, "minute");
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
    return (
      <Card>
        <CardContent className="flex flex-col gap-3" role="status" aria-live="polite">
          <div>
            <h2 className="text-[length:var(--text-panel-title)] font-semibold">
              Analytics could not be loaded
            </h2>
            <p className="mt-1 text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[color:var(--ega-text-secondary)]">
              {model.error ??
                "The analytics report did not come back. Your tasks and sessions are unaffected."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/today"
              className="btn-instrument flex h-8 items-center px-3 text-sm"
            >
              Open Today
            </Link>
            <Link
              href="/work-analytics"
              className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-sm"
            >
              Retry
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }
  const report = model.report;
  const tasksWithEstimates =
    report.estimateAccuracy.overCount +
    report.estimateAccuracy.underCount +
    report.estimateAccuracy.exactCount;
  const weekDelta = report.thisWeekInsights;
  const groupBy = model.filters?.groupBy ?? "day";
  const estimateRatio =
    report.estimateAccuracy.totalEstimatedMinutes > 0
      ? report.estimateAccuracy.totalTrackedMinutes /
        report.estimateAccuracy.totalEstimatedMinutes
      : null;

  const weekChangeLabel =
    weekDelta.percentChange === null
      ? "No prior 7-day data"
      : `${signedPercent(weekDelta.percentChange)} · ${signedDuration(weekDelta.deltaMinutes)}`;

  return (
    <div className="flex flex-col gap-6" data-testid="work-analytics-workspace">
      <DashboardSection
        title="Execution overview"
        description={`Focused time, session volume, and estimate variance for ${report.selectedRangeLabel}.`}
      >
        <div className="kpi-grid">
          <StatCard
            data-testid="analytics-kpi-focused-time"
            label="Focused time"
            icon={Clock3}
            value={formatMinutes(report.selectedSummary.workedMinutes)}
            trend={
              report.selectedComparison.percentChange === null ? undefined : (
                <MetricDelta
                  value={signedPercent(report.selectedComparison.percentChange)}
                  direction={report.selectedComparison.deltaMinutes >= 0 ? "up" : "down"}
                  label={report.selectedComparisonLabel}
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
            data-testid="analytics-kpi-estimate-variance"
            label="Estimate variance"
            icon={Target}
            value={estimateRatio === null ? DISPLAY_EMPTY : signedDuration(report.estimateAccuracy.estimateDeltaMinutes)}
            trend={
              estimateRatio === null ? undefined : (
                <MetricDelta
                  value={formatDisplayMultiple(estimateRatio)}
                  direction={
                    report.estimateAccuracy.estimateDeltaMinutes > 0
                      ? "up"
                      : report.estimateAccuracy.estimateDeltaMinutes < 0
                        ? "down"
                        : "flat"
                  }
                  higherIsBetter={false}
                  label="estimate"
                />
              )
            }
            subtitle={
              estimateRatio === null
                ? `No estimate on ${report.estimateAccuracy.noEstimateCount} tasks`
                : `${signedPercent(report.estimateAccuracy.estimateDeltaPercent)} variance · Estimated ${formatMinutes(report.estimateAccuracy.totalEstimatedMinutes)} · tracked ${formatMinutes(report.estimateAccuracy.totalTrackedMinutes)}`
            }
          />
        </div>
      </DashboardSection>

      <InteractiveAnalytics
        drilldownIndexes={report.drilldownIndexes}
        recentDateDrilldownIndex={report.recentDateDrilldownIndex}
        primarySeries={report.selectedSeries}
        selectedSeriesRollingAverage={report.selectedSeriesRollingAverage}
        weekdayDistribution={report.weekdayDistribution}
        primaryTitle={`Focus time — ${report.selectedRangeLabel}`}
        last7DaysSeries={report.last7DaysSeries}
        breakdownBy={report.breakdownBy}
        breakdownTitle={report.breakdownTitle}
        projectBreakdown={report.projectBreakdown}
        goalBreakdown={report.goalBreakdown}
        taskBreakdown={report.taskBreakdown}
        selectedRangeLabel={report.selectedRangeLabel}
        groupBy={groupBy}
      >
        <DashboardSection
          title="Estimates and context"
          description="How tracked time compares with what you estimated, plus the surrounding periods."
        >
          <div className="grid gap-4 lg:grid-cols-3">
            <Card label="Estimate variance" title="Tracked vs estimated">
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
                {estimateRatio === null ? (
                  <p className="text-[length:var(--text-meta)] leading-[var(--leading-snug)] text-ega-text-secondary">
                    No estimated tasks in this range.
                  </p>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
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
                      label={
                        report.estimateAccuracy.estimateDeltaMinutes === 0
                          ? "on estimate"
                          : report.estimateAccuracy.estimateDeltaMinutes > 0
                            ? "over estimate"
                            : "under estimate"
                      }
                    />
                    <span className="text-[length:var(--text-meta)] text-ega-text-tertiary">
                      {formatDisplayMultiple(estimateRatio)} estimate ·{" "}
                      {signedPercent(report.estimateAccuracy.estimateDeltaPercent)} variance
                    </span>
                  </div>
                )}
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

            <Card label="Context" title="Period context">
              <CardContent className="flex flex-col gap-5" data-testid="analytics-context">
                <div className="rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[var(--ega-surface-subtle)] p-4">
                  <p className="glass-label">Selected period</p>
                  <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-[length:var(--text-metric)] font-semibold tabular-nums text-ega-text">
                      {formatMinutes(report.selectedSummary.workedMinutes)}
                    </span>
                    <span className="text-[length:var(--text-meta-lg)] text-ega-text-secondary">
                      {report.selectedRangeLabel} · {report.selectedSummary.sessionCount} sessions ·{" "}
                      {report.selectedSummary.activeDays} active days
                    </span>
                  </div>
                  <p className="mt-1 text-[length:var(--text-meta)] text-ega-text-tertiary">
                    {report.selectedComparisonLabel.replace(/^vs /, "Compared with ")}:{" "}
                    {formatMinutes(report.selectedComparison.previousPeriodWorkedMinutes)}
                    {report.selectedComparison.percentChange === null
                      ? ""
                      : ` (${signedPercent(report.selectedComparison.percentChange)})`}
                  </p>
                </div>

                <div>
                  <p className="glass-label">Calendar context</p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3">
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
                      label="Change vs previous month"
                      value={`${signedPercent(report.monthComparison.percentChange)}${
                        report.monthComparison.hasPreviousData
                          ? ` · ${signedDuration(report.monthComparison.deltaMinutes)}`
                          : " · no previous month data"
                      }`}
                    />
                    <ContextStat
                      label="Average active day"
                      value={`${formatMinutes(
                        report.monthComparison.currentMonthAvgPerActiveDayMinutes,
                      )} (${report.monthComparison.currentMonthActiveDays} days)`}
                    />
                  </dl>
                </div>

                <div>
                  <p className="glass-label">Recent trends</p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3">
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
                      label="Change vs prior 7 days"
                      value={`${signedPercent(weekDelta.percentChange)}${
                        weekDelta.percentChange === null
                          ? " · no prior 7-day data"
                          : ` · ${signedDuration(weekDelta.deltaMinutes)}`
                      }`}
                    />
                    <ContextStat
                      label="Last 30 days"
                      value={`${formatMinutes(report.summary.last30DaysWorkedMinutes)} · ${
                        report.summary.last30DaysSessionCount
                      } sessions`}
                    />
                    <ContextStat
                      label="Average session"
                      value={formatMinutes(report.summary.averageSessionLengthMinutes)}
                    />
                  </dl>
                </div>
              </CardContent>
            </Card>
          </div>
        </DashboardSection>
      </InteractiveAnalytics>
    </div>
  );
}
