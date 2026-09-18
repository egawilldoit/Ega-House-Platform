import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDurationLabel } from "@/lib/task-session";
import { InteractiveAnalytics } from "../interactive-analytics";
import { AnalyticsFilters } from "../analytics-filters";
import type { WorkAnalyticsPageModel } from "../_lib/work-analytics-page-model";

function signedPercent(value: number | null) {
  if (value === null) return "--";
  return `${value >= 0 ? "+" : ""}${value}%`;
}

function deltaTone(value: number) {
  if (value > 0) return "text-signal-error";
  if (value < 0) return "text-signal-live";
  return "";
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

  return (
    <div className="analytics-workspace">
      <div className="analytics-filter-band">
        <AnalyticsFilters />
      </div>

      <section className="analytics-kpi-strip" aria-label="Primary analytics metrics">
        <article
          className="analytics-kpi analytics-kpi-primary"
          data-testid="analytics-kpi-focused-time"
        >
          <p className="analytics-kpi-label">Focused time</p>
          <p className="analytics-kpi-value">
            {formatDurationLabel(report.selectedSummary.workedMinutes * 60)}
          </p>
          <p className="analytics-kpi-detail">
            {report.selectedRangeLabel} · {report.selectedSummary.sessionCount} sessions
          </p>
        </article>

        <article className="analytics-kpi" data-testid="analytics-kpi-active-days">
          <p className="analytics-kpi-label">Active days</p>
          <p className="analytics-kpi-value">{report.selectedSummary.activeDays}</p>
          <p className="analytics-kpi-detail">
            {formatDurationLabel(
              report.selectedSummary.averageWorkPerActiveDayMinutes * 60,
            )}{" "}
            average
          </p>
        </article>

        <article className="analytics-kpi" data-testid="analytics-kpi-tasks-completed">
          <p className="analytics-kpi-label">Tasks completed</p>
          <p className="analytics-kpi-value">
            {report.selectedSummary.completedTaskCount}
          </p>
          <p className="analytics-kpi-detail">
            {report.selectedSummary.createdTaskCount} created ·{" "}
            {report.selectedSummary.blockedTaskCount} blocked
          </p>
        </article>

        <article className="analytics-kpi" data-testid="analytics-kpi-estimate-accuracy">
          <p className="analytics-kpi-label">Estimate delta</p>
          <p
            className={`analytics-kpi-value ${deltaTone(
              report.estimateAccuracy.estimateDeltaMinutes,
            )}`}
          >
            {signedPercent(report.estimateAccuracy.estimateDeltaPercent)}
          </p>
          <p className="analytics-kpi-detail">Tracked vs estimated</p>
        </article>
      </section>

      <section className="analytics-detail-grid" aria-label="Planning and context">
        <Card className="analytics-accuracy-card">
          <CardHeader className="analytics-card-heading">
            <div>
              <p className="analytics-section-kicker">Planning signal</p>
              <CardTitle className="text-base">Estimate accuracy</CardTitle>
            </div>
            <p className="analytics-card-caption">
              {tasksWithEstimates} estimated task{tasksWithEstimates === 1 ? "" : "s"}
            </p>
          </CardHeader>
          <CardContent>
            <div
              className="analytics-accuracy-comparison"
              data-testid="analytics-accuracy-comparison"
            >
              <div className="analytics-accuracy-primary">
                <p className="analytics-kpi-label">Estimated</p>
                <p className="analytics-accuracy-value">
                  {formatDurationLabel(report.estimateAccuracy.totalEstimatedMinutes * 60)}
                </p>
              </div>
              <div className="analytics-accuracy-primary">
                <p className="analytics-kpi-label">Tracked</p>
                <p className="analytics-accuracy-value">
                  {formatDurationLabel(report.estimateAccuracy.totalTrackedMinutes * 60)}
                </p>
              </div>
              <div className="analytics-accuracy-delta">
                <p className="analytics-kpi-label">Delta</p>
                <p
                  className={`analytics-accuracy-value ${deltaTone(
                    report.estimateAccuracy.estimateDeltaMinutes,
                  )}`}
                >
                  {signedPercent(report.estimateAccuracy.estimateDeltaPercent)}
                </p>
                <p className="analytics-kpi-detail">
                  {report.estimateAccuracy.estimateDeltaMinutes >= 0 ? "+" : "-"}
                  {formatDurationLabel(
                    Math.abs(report.estimateAccuracy.estimateDeltaMinutes) * 60,
                  )}
                </p>
              </div>
            </div>

            <p className="analytics-accuracy-secondary">
              {report.estimateAccuracy.overCount} over ·{" "}
              {report.estimateAccuracy.underCount} under ·{" "}
              {report.estimateAccuracy.exactCount} exact ·{" "}
              {report.estimateAccuracy.noEstimateCount} without estimate
            </p>
          </CardContent>
        </Card>

        <details className="analytics-context-card" data-testid="analytics-context">
          <summary className="analytics-context-trigger">
            <span>
              <span className="analytics-section-kicker">Context</span>
              <span className="analytics-context-title">More signals</span>
            </span>
            <span className="analytics-context-hint">Day, session & month detail</span>
          </summary>

          <dl className="analytics-context-grid">
            <div>
              <dt>Today</dt>
              <dd>
                {formatDurationLabel(report.summary.todayWorkedMinutes * 60)} ·{" "}
                {report.summary.todaySessionCount} sessions
              </dd>
            </div>
            <div>
              <dt>Yesterday</dt>
              <dd>
                {formatDurationLabel(report.yesterday.workedMinutes * 60)} ·{" "}
                {report.yesterday.sessionCount} sessions
              </dd>
            </div>
            <div>
              <dt>Last 7 days</dt>
              <dd>
                {formatDurationLabel(report.summary.last7DaysWorkedMinutes * 60)} ·{" "}
                {report.summary.last7DaysSessionCount} sessions
              </dd>
            </div>
            <div>
              <dt>Last 30 days</dt>
              <dd>
                {formatDurationLabel(report.summary.last30DaysWorkedMinutes * 60)} ·{" "}
                {report.summary.last30DaysSessionCount} sessions
              </dd>
            </div>
            <div>
              <dt>Avg session</dt>
              <dd>{formatDurationLabel(report.summary.averageSessionLengthMinutes * 60)}</dd>
            </div>
            <div>
              <dt>Streak</dt>
              <dd>{report.thisWeekInsights.currentStreak} days</dd>
            </div>
            <div>
              <dt>Month-to-date</dt>
              <dd>
                {formatDurationLabel(report.monthComparison.currentMonthMinutes * 60)} ·{" "}
                {report.monthComparison.currentMonthSessionCount} sessions
              </dd>
            </div>
            <div>
              <dt>Previous month</dt>
              <dd>
                {formatDurationLabel(report.monthComparison.previousMonthMinutes * 60)} ·{" "}
                {report.monthComparison.previousMonthSessionCount} sessions
              </dd>
            </div>
            <div>
              <dt>MoM delta</dt>
              <dd>
                {signedPercent(report.monthComparison.percentChange)}
                {report.monthComparison.hasPreviousData
                  ? ` · ${report.monthComparison.deltaMinutes >= 0 ? "+" : "-"}${formatDurationLabel(
                      Math.abs(report.monthComparison.deltaMinutes) * 60,
                    )} vs prev`
                  : " · no previous month data"}
              </dd>
            </div>
            <div>
              <dt>Avg active day</dt>
              <dd>
                {formatDurationLabel(
                  report.monthComparison.currentMonthAvgPerActiveDayMinutes * 60,
                )}{" "}
                ({report.monthComparison.currentMonthActiveDays} days)
              </dd>
            </div>
          </dl>
        </details>
      </section>

      <InteractiveAnalytics
        drilldownIndexes={report.drilldownIndexes}
        primarySeries={report.selectedSeries}
        primaryTitle={`Focus time — ${report.selectedRangeLabel}`}
        primaryGroupBy={model.filters.groupBy}
        last7DaysSeries={report.last7DaysSeries}
        recentDateDrilldownIndex={report.recentDateDrilldownIndex}
        breakdownBy={report.breakdownBy}
        breakdownTitle={report.breakdownTitle}
        projectBreakdown={report.projectBreakdown}
        goalBreakdown={report.goalBreakdown}
        taskBreakdown={report.taskBreakdown}
        insightsDeltaMinutes={report.thisWeekInsights.deltaMinutes}
        insightsBestDay={report.thisWeekInsights.bestDay?.date ?? null}
        insightsLowestDay={report.thisWeekInsights.lowestNonZeroDay?.date ?? null}
        insightsAvgSessionMinutes={report.thisWeekInsights.averageSessionLength}
        insightsLongestSessionMinutes={report.thisWeekInsights.longestSession}
      />
    </div>
  );
}
