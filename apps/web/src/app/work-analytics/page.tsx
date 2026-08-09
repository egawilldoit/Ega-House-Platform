import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDurationLabel } from "@/lib/task-session";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getWorkAnalyticsSessionsForWindow, getWorkAnalyticsTaskCounts } from "@/lib/services/work-analytics-data-adapter";
import {
  parseAnalyticsFilters,
  computeWindowForRange,
} from "@/lib/services/work-analytics-filters";
import { buildWorkAnalyticsReport } from "@/lib/services/work-analytics-report-builder";
import { InteractiveAnalytics } from "./interactive-analytics";
import { AnalyticsFilters } from "./analytics-filters";

export const dynamic = "force-dynamic";

type WorkAnalyticsPageProps = {
  searchParams: Promise<{
    range?: string;
    groupBy?: string;
    breakdownBy?: string;
    includeOpen?: string;
  }>;
};

export default async function WorkAnalyticsPage({
  searchParams,
}: WorkAnalyticsPageProps) {
  const user = await getCurrentUser();
  if (!user) {
    return <div className="p-6">Please log in to view work analytics.</div>;
  }

  // Resolve and parse search params
  const resolvedSearchParams = await searchParams;
  const filters = parseAnalyticsFilters(
    new URLSearchParams(
      Object.entries(resolvedSearchParams)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, v!]),
    ),
  );

  const now = new Date();

  // Compute window based on selected range
  const primaryWindow = computeWindowForRange(filters.range, now);

  // Fetch sessions for the primary window
  const sessionsResult = await getWorkAnalyticsSessionsForWindow({
    ownerUserId: user.id,
    window: primaryWindow,
  });

  if (sessionsResult.errorMessage || !sessionsResult.data) {
    return <div className="p-6">Failed to load work analytics data.</div>;
  }

  const sessions = sessionsResult.data;

  // Fetch task counts for the same window
  const taskCountsResult = await getWorkAnalyticsTaskCounts({
    ownerUserId: user.id,
    window: primaryWindow,
  });
  const taskCounts = taskCountsResult.data ?? {
    completedCount: 0,
    createdCount: 0,
    blockedCount: 0,
  };

  // Build the full report in one call — all metrics computed from same sessions
  const report = buildWorkAnalyticsReport(sessions, taskCounts, filters, now);

  return (
    <AppShell
      eyebrow="Execution"
      title="Work Analytics"
      description="Worked time/session signals for today, week, and recent trend."
    >
      {/* Filters row */}
      <div className="mb-6">
        <AnalyticsFilters />
      </div>

      {/* Core summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Today</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatDurationLabel(report.summary.todayWorkedMinutes * 60)}
            </div>
            <div className="text-xs text-muted-foreground">
              {report.summary.todaySessionCount} sessions
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Yesterday</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatDurationLabel(report.yesterday.workedMinutes * 60)}
            </div>
            <div className="text-xs text-muted-foreground">
              {report.yesterday.sessionCount} sessions
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Last 7 days</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatDurationLabel(report.summary.last7DaysWorkedMinutes * 60)}
            </div>
            <div className="text-xs text-muted-foreground">
              {report.summary.last7DaysSessionCount} sessions
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Last 30 days</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatDurationLabel(report.summary.last30DaysWorkedMinutes * 60)}
            </div>
            <div className="text-xs text-muted-foreground">
              {report.summary.last30DaysSessionCount} sessions
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Secondary info row: active days, average, session length */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Active days (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{report.summary.activeDays}</div>
            <div className="text-xs text-muted-foreground">
              Avg {formatDurationLabel(report.summary.averageWorkPerActiveDayMinutes * 60)}/day
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Avg session</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatDurationLabel(report.summary.averageSessionLengthMinutes * 60)}
            </div>
            <div className="text-xs text-muted-foreground">
              across {report.summary.last30DaysSessionCount} sessions
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Tasks completed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {report.summary.completedTaskCount}
            </div>
            <div className="text-xs text-muted-foreground">
              {report.summary.createdTaskCount} created, {report.summary.blockedTaskCount} blocked
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Streak</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {report.thisWeekInsights.currentStreak} days
            </div>
            <div className="text-xs text-muted-foreground">
              current streak
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Month-to-date comparison */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Month-to-date</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatDurationLabel(report.monthComparison.currentMonthMinutes * 60)}
            </div>
            <div className="text-xs text-muted-foreground">
              {report.monthComparison.currentMonthSessionCount} sessions ·{" "}
              {report.monthComparison.currentMonthActiveDays} active days
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Previous month</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatDurationLabel(report.monthComparison.previousMonthMinutes * 60)}
            </div>
            <div className="text-xs text-muted-foreground">
              {report.monthComparison.previousMonthSessionCount} sessions
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">MoM delta</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                report.monthComparison.deltaMinutes >= 0
                  ? "text-green-600"
                  : "text-red-600"
              }`}
            >
              {report.monthComparison.percentChange !== null
                ? `${report.monthComparison.percentChange >= 0 ? "+" : ""}${report.monthComparison.percentChange}%`
                : "--"}
            </div>
            <div className="text-xs text-muted-foreground">
              {report.monthComparison.hasPreviousData
                ? `${report.monthComparison.deltaMinutes >= 0 ? "+" : ""}${formatDurationLabel(Math.abs(report.monthComparison.deltaMinutes) * 60)} vs prev`
                : "No previous month data"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Avg active day</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatDurationLabel(
                report.monthComparison.currentMonthAvgPerActiveDayMinutes * 60,
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {report.monthComparison.currentMonthActiveDays > 0
                ? `across ${report.monthComparison.currentMonthActiveDays} days`
                : "No activity this month"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Estimate accuracy panel */}
      <div className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Estimate accuracy</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
              <div>
                <div className="text-xs text-muted-foreground">Estimated</div>
                <div className="text-lg font-bold">{formatDurationLabel(report.estimateAccuracy.totalEstimatedMinutes * 60)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Tracked</div>
                <div className="text-lg font-bold">{formatDurationLabel(report.estimateAccuracy.totalTrackedMinutes * 60)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Delta</div>
                <div className={`text-lg font-bold ${report.estimateAccuracy.estimateDeltaMinutes > 0 ? 'text-red-600' : report.estimateAccuracy.estimateDeltaMinutes < 0 ? 'text-green-600' : ''}`}>
                  {report.estimateAccuracy.estimateDeltaPercent !== null
                    ? `${report.estimateAccuracy.estimateDeltaMinutes >= 0 ? '+' : ''}${report.estimateAccuracy.estimateDeltaPercent}%`
                    : '--'}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Tasks with estimates</div>
                <div className="text-lg font-bold">
                  {report.estimateAccuracy.overCount + report.estimateAccuracy.underCount + report.estimateAccuracy.exactCount}
                  <span className="text-xs text-muted-foreground ml-1">
                    ({report.estimateAccuracy.overCount} over, {report.estimateAccuracy.underCount} under)
                  </span>
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">No estimate</div>
                <div className="text-lg font-bold">{report.estimateAccuracy.noEstimateCount}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* InteractiveAnalytics: trend charts, breakdown cards, and drilldown drawer */}
      <InteractiveAnalytics
        drilldownIndexes={report.drilldownIndexes}
        last7DaysSeries={report.last7DaysSeries}
        last30DaysSeries={report.last30DaysSeries}
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
    </AppShell>
  );
}
