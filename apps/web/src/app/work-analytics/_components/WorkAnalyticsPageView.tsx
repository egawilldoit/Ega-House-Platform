import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDurationLabel } from "@/lib/task-session";
import { InteractiveAnalytics } from "../interactive-analytics";
import { AnalyticsFilters } from "../analytics-filters";
import type { WorkAnalyticsPageModel } from "../_lib/work-analytics-page-model";

function signedPercent(value: number | null) {
  if (value === null) return "--";
  return `${value >= 0 ? "+" : ""}${value}%`;
}

export function WorkAnalyticsPageView({ model }: { model: WorkAnalyticsPageModel }) {
  if (model.error || !model.report) return <div className="p-6">{model.error ?? "Failed to load work analytics data."}</div>;
  const report = model.report;
  const tasksWithEstimates = report.estimateAccuracy.overCount + report.estimateAccuracy.underCount + report.estimateAccuracy.exactCount;

  return (
    <div className="analytics-workspace">
      <div className="analytics-filter-band"><AnalyticsFilters /></div>

      <section className="analytics-kpi-strip" aria-label="Primary analytics metrics">
        <article className="analytics-kpi" data-testid="analytics-kpi-focused-time">
          <p className="glass-label text-etch">Focused time</p>
          <p className="analytics-kpi-value">{formatDurationLabel(report.selectedSummary.workedMinutes * 60)}</p>
          <p className="analytics-kpi-detail">
            {report.selectedRangeLabel} · {report.selectedSummary.sessionCount} sessions
          </p>
        </article>
        <article className="analytics-kpi" data-testid="analytics-kpi-active-days">
          <p className="glass-label text-etch">Active days</p>
          <p className="analytics-kpi-value">{report.selectedSummary.activeDays}</p>
          <p className="analytics-kpi-detail">
            Avg {formatDurationLabel(report.selectedSummary.averageWorkPerActiveDayMinutes * 60)}/active day
          </p>
        </article>
        <article className="analytics-kpi" data-testid="analytics-kpi-tasks-completed">
          <p className="glass-label text-etch">Tasks completed</p>
          <p className="analytics-kpi-value">{report.selectedSummary.completedTaskCount}</p>
          <p className="analytics-kpi-detail">
            {report.selectedSummary.createdTaskCount} created · {report.selectedSummary.blockedTaskCount} blocked
          </p>
        </article>
        <article className="analytics-kpi" data-testid="analytics-kpi-estimate-accuracy">
          <p className="glass-label text-etch">Estimate accuracy</p>
          <p className="analytics-kpi-value">{signedPercent(report.estimateAccuracy.estimateDeltaPercent)}</p>
          <p className="analytics-kpi-detail">tracked vs estimated · {report.selectedRangeLabel}</p>
        </article>
      </section>

      <details className="analytics-context-card" data-testid="analytics-context">
        <summary className="analytics-context-trigger">More context</summary>
        <dl className="analytics-context-grid">
          <div><dt>Today</dt><dd>{formatDurationLabel(report.summary.todayWorkedMinutes * 60)} · {report.summary.todaySessionCount} sessions</dd></div>
          <div><dt>Yesterday</dt><dd>{formatDurationLabel(report.yesterday.workedMinutes * 60)} · {report.yesterday.sessionCount} sessions</dd></div>
          <div><dt>Last 7 days</dt><dd>{formatDurationLabel(report.summary.last7DaysWorkedMinutes * 60)} · {report.summary.last7DaysSessionCount} sessions</dd></div>
          <div><dt>Last 30 days</dt><dd>{formatDurationLabel(report.summary.last30DaysWorkedMinutes * 60)} · {report.summary.last30DaysSessionCount} sessions</dd></div>
          <div><dt>Avg session</dt><dd>{formatDurationLabel(report.summary.averageSessionLengthMinutes * 60)}</dd></div>
          <div><dt>Streak</dt><dd>{report.thisWeekInsights.currentStreak} days</dd></div>
          <div><dt>Month-to-date</dt><dd>{formatDurationLabel(report.monthComparison.currentMonthMinutes * 60)} · {report.monthComparison.currentMonthSessionCount} sessions</dd></div>
          <div><dt>Previous month</dt><dd>{formatDurationLabel(report.monthComparison.previousMonthMinutes * 60)} · {report.monthComparison.previousMonthSessionCount} sessions</dd></div>
          <div>
            <dt>MoM delta</dt>
            <dd>
              {signedPercent(report.monthComparison.percentChange)}
              {report.monthComparison.hasPreviousData
                ? ` · ${report.monthComparison.deltaMinutes >= 0 ? "+" : "-"}${formatDurationLabel(Math.abs(report.monthComparison.deltaMinutes) * 60)} vs prev`
                : " · no previous month data"}
            </dd>
          </div>
          <div><dt>Avg active day</dt><dd>{formatDurationLabel(report.monthComparison.currentMonthAvgPerActiveDayMinutes * 60)} ({report.monthComparison.currentMonthActiveDays} days)</dd></div>
        </dl>
      </details>

      <section className="analytics-accuracy-section mt-4">
        <Card className="analytics-accuracy-card">
          <CardHeader><CardTitle className="text-sm">Estimate accuracy</CardTitle></CardHeader>
          <CardContent>
            <div className="analytics-accuracy-comparison" data-testid="analytics-accuracy-comparison">
              <div className="analytics-accuracy-primary">
                <p className="glass-label text-etch">Estimated</p>
                <p className="analytics-kpi-value">{formatDurationLabel(report.estimateAccuracy.totalEstimatedMinutes * 60)}</p>
              </div>
              <div className="analytics-accuracy-primary">
                <p className="glass-label text-etch">Tracked</p>
                <p className="analytics-kpi-value">{formatDurationLabel(report.estimateAccuracy.totalTrackedMinutes * 60)}</p>
              </div>
              <div className="analytics-accuracy-delta">
                <p className="glass-label text-etch">Delta</p>
                <p
                  className={`analytics-kpi-value ${
                    report.estimateAccuracy.estimateDeltaMinutes > 0
                      ? "text-signal-error"
                      : report.estimateAccuracy.estimateDeltaMinutes < 0
                        ? "text-signal-live"
                        : ""
                  }`}
                >
                  {signedPercent(report.estimateAccuracy.estimateDeltaPercent)}
                </p>
                <p className="analytics-kpi-detail">
                  {report.estimateAccuracy.estimateDeltaMinutes >= 0 ? "+" : "-"}
                  {formatDurationLabel(Math.abs(report.estimateAccuracy.estimateDeltaMinutes) * 60)} vs estimate
                </p>
              </div>
            </div>
            <p className="analytics-accuracy-secondary text-sm text-[color:var(--muted-foreground)]">
              Tasks with estimates {tasksWithEstimates} ({report.estimateAccuracy.overCount} over, {report.estimateAccuracy.underCount} under, {report.estimateAccuracy.exactCount} exact)
              · No estimate {report.estimateAccuracy.noEstimateCount}
            </p>
          </CardContent>
        </Card>
      </section>

      <InteractiveAnalytics drilldownIndexes={report.drilldownIndexes} primarySeries={report.selectedSeries} primaryTitle={`Focus time — ${report.selectedRangeLabel}`} last7DaysSeries={report.last7DaysSeries} last30DaysSeries={report.last30DaysSeries} breakdownBy={report.breakdownBy} breakdownTitle={report.breakdownTitle} projectBreakdown={report.projectBreakdown} goalBreakdown={report.goalBreakdown} taskBreakdown={report.taskBreakdown} insightsDeltaMinutes={report.thisWeekInsights.deltaMinutes} insightsBestDay={report.thisWeekInsights.bestDay?.date ?? null} insightsLowestDay={report.thisWeekInsights.lowestNonZeroDay?.date ?? null} insightsAvgSessionMinutes={report.thisWeekInsights.averageSessionLength} insightsLongestSessionMinutes={report.thisWeekInsights.longestSession} />
    </div>
  );
}
