import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendBarChart } from "@/components/review/trend-bar-chart";
import { formatDurationLabel } from "@/lib/task-session";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getWorkAnalyticsSessionsForWindow, getWorkAnalyticsTaskCounts } from "@/lib/services/work-analytics-data-adapter";
import {
  calculateWorkAnalyticsCoreSummary,
  calculateWorkAnalyticsDailySeries,
  calculateWorkAnalyticsInsights,
  calculateWorkAnalyticsMonthComparison,
  calculateWorkAnalyticsProjectBreakdown,
} from "@/lib/services/work-analytics-service";

export const dynamic = "force-dynamic";

function daysAgoIsoDate(days: number, now: Date) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function windowFromDays(days: number, now: Date) {
  const end = new Date(now);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - days);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export default async function WorkAnalyticsPage() {
  const user = await getCurrentUser();
  if (!user) {
    return <div className="p-6">Please log in to view work analytics.</div>;
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const yesterdayStart = daysAgoIsoDate(1, now);
  const weekWindow = windowFromDays(7, now);
  const monthWindow = windowFromDays(30, now);

  const monthSessionsResult = await getWorkAnalyticsSessionsForWindow({
    ownerUserId: user.id,
    window: monthWindow,
  });

  if (monthSessionsResult.errorMessage || !monthSessionsResult.data) {
    return <div className="p-6">Failed to load work analytics data.</div>;
  }

  const sessions = monthSessionsResult.data;

  // Fetch task counts for the same window
  const taskCountsResult = await getWorkAnalyticsTaskCounts({
    ownerUserId: user.id,
    window: monthWindow,
  });
  const taskCounts = taskCountsResult.data ?? { completedCount: 0, createdCount: 0, blockedCount: 0 };

  // Core summary using the new function
  const summary = calculateWorkAnalyticsCoreSummary(sessions, monthWindow, taskCounts, { nowIso });

  // Trend and breakdown calculations
  const yesterdaySeries = calculateWorkAnalyticsDailySeries(sessions, yesterdayStart, yesterdayStart, { nowIso });
  const yesterday = yesterdaySeries[0] ?? { workedMinutes: 0, sessionCount: 0 };
  const thisWeekInsights = calculateWorkAnalyticsInsights(sessions, weekWindow, { nowIso });
  const last7DaysSeries = calculateWorkAnalyticsDailySeries(sessions, daysAgoIsoDate(6, now), nowIso.slice(0, 10), { nowIso });
  const last30DaysSeries = calculateWorkAnalyticsDailySeries(sessions, daysAgoIsoDate(29, now), nowIso.slice(0, 10), { nowIso });
  const last30Breakdown = calculateWorkAnalyticsProjectBreakdown(sessions, monthWindow, { nowIso });

  // Month-to-date comparison
  const monthComparison = calculateWorkAnalyticsMonthComparison(sessions, { nowIso });

  return (
    <AppShell eyebrow="Execution" title="Work Analytics" description="Worked time/session signals for today, week, and recent trend.">
      {/* Core summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Today</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatDurationLabel(summary.todayWorkedMinutes * 60)}</div>
            <div className="text-xs text-muted-foreground">{summary.todaySessionCount} sessions</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Yesterday</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatDurationLabel(yesterday.workedMinutes * 60)}</div>
            <div className="text-xs text-muted-foreground">{yesterday.sessionCount} sessions</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Last 7 days</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatDurationLabel(summary.last7DaysWorkedMinutes * 60)}</div>
            <div className="text-xs text-muted-foreground">{summary.last7DaysSessionCount} sessions</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Last 30 days</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatDurationLabel(summary.last30DaysWorkedMinutes * 60)}</div>
            <div className="text-xs text-muted-foreground">{summary.last30DaysSessionCount} sessions</div>
          </CardContent>
        </Card>
      </div>

      {/* Secondary info row: active days, average, session length */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Active days (30d)</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.activeDays}</div>
            <div className="text-xs text-muted-foreground">Avg {formatDurationLabel(summary.averageWorkPerActiveDayMinutes * 60)}/day</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Avg session</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatDurationLabel(summary.averageSessionLengthMinutes * 60)}</div>
            <div className="text-xs text-muted-foreground">across {summary.last30DaysSessionCount} sessions</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Tasks completed</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.completedTaskCount}</div>
            <div className="text-xs text-muted-foreground">{summary.createdTaskCount} created, {summary.blockedTaskCount} blocked</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Streak</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{thisWeekInsights.currentStreak} days</div>
            <div className="text-xs text-muted-foreground">current streak</div>
          </CardContent>
        </Card>
      </div>

      {/* Month-to-date comparison */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Month-to-date</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatDurationLabel(monthComparison.currentMonthMinutes * 60)}</div>
            <div className="text-xs text-muted-foreground">{monthComparison.currentMonthSessionCount} sessions · {monthComparison.currentMonthActiveDays} active days</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Previous month</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatDurationLabel(monthComparison.previousMonthMinutes * 60)}</div>
            <div className="text-xs text-muted-foreground">{monthComparison.previousMonthSessionCount} sessions</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">MoM delta</CardTitle></CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${monthComparison.deltaMinutes >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {monthComparison.percentChange !== null ? `${monthComparison.percentChange >= 0 ? '+' : ''}${monthComparison.percentChange}%` : '--'}
            </div>
            <div className="text-xs text-muted-foreground">
              {monthComparison.hasPreviousData
                ? `${monthComparison.deltaMinutes >= 0 ? '+' : ''}${formatDurationLabel(Math.abs(monthComparison.deltaMinutes) * 60)} vs prev`
                : 'No previous month data'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Avg active day</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatDurationLabel(monthComparison.currentMonthAvgPerActiveDayMinutes * 60)}</div>
            <div className="text-xs text-muted-foreground">
              {monthComparison.currentMonthActiveDays > 0
                ? `across ${monthComparison.currentMonthActiveDays} days`
                : 'No activity this month'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Trend charts and breakdown cards */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TrendBarChart data={last7DaysSeries} title="Last 7 days" />
        <TrendBarChart data={last30DaysSeries} title="Last 30 days" />
        <Card><CardHeader><CardTitle>Project breakdown (30d)</CardTitle></CardHeader><CardContent>{last30Breakdown.length === 0 ? "No project data" : last30Breakdown.map((p) => `${p.projectName}: ${p.workedMinutes}m/${p.sessionCount}`).join(" | ")}</CardContent></Card>
        <Card><CardHeader><CardTitle>Insights</CardTitle></CardHeader><CardContent>Delta {thisWeekInsights.deltaMinutes}m · Best {thisWeekInsights.bestDay?.date ?? "n/a"} · Lowest {thisWeekInsights.lowestNonZeroDay?.date ?? "n/a"} · Avg {thisWeekInsights.averageSessionLength}m · Longest {thisWeekInsights.longestSession}m</CardContent></Card>
      </div>
    </AppShell>
  );
}
