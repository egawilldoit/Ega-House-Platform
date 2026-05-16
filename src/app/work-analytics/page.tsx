import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDurationLabel } from "@/lib/task-session";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getWorkAnalyticsSessionsForWindow } from "@/lib/services/work-analytics-data-adapter";
import {
  calculateWorkAnalytics,
  calculateWorkAnalyticsDailySeries,
  calculateWorkAnalyticsInsights,
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
  const todayWindow = { startIso: `${nowIso.slice(0, 10)}T00:00:00.000Z`, endIso: nowIso };
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
  const today = calculateWorkAnalytics(sessions, todayWindow, { nowIso });
  const yesterdaySeries = calculateWorkAnalyticsDailySeries(sessions, yesterdayStart, yesterdayStart, { nowIso });
  const yesterday = yesterdaySeries[0] ?? { workedMinutes: 0, sessionCount: 0 };
  const thisWeek = calculateWorkAnalytics(sessions, weekWindow, { nowIso });
  const thisWeekInsights = calculateWorkAnalyticsInsights(sessions, weekWindow, { nowIso });
  const last7DaysSeries = calculateWorkAnalyticsDailySeries(sessions, daysAgoIsoDate(6, now), nowIso.slice(0, 10), { nowIso });
  const last30DaysSeries = calculateWorkAnalyticsDailySeries(sessions, daysAgoIsoDate(29, now), nowIso.slice(0, 10), { nowIso });
  const last30Breakdown = calculateWorkAnalyticsProjectBreakdown(sessions, monthWindow, { nowIso });

  return (
    <AppShell eyebrow="Execution" title="Work Analytics" description="Worked time/session signals for today, week, and recent trend.">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card><CardHeader><CardTitle>Today</CardTitle></CardHeader><CardContent>{formatDurationLabel(today.totalWorkedMinutes * 60)} · {today.sessionCount} sessions</CardContent></Card>
        <Card><CardHeader><CardTitle>Yesterday</CardTitle></CardHeader><CardContent>{formatDurationLabel(yesterday.workedMinutes * 60)} · {yesterday.sessionCount} sessions</CardContent></Card>
        <Card><CardHeader><CardTitle>This week</CardTitle></CardHeader><CardContent>{formatDurationLabel(thisWeek.totalWorkedMinutes * 60)} · {thisWeek.sessionCount} sessions</CardContent></Card>
        <Card><CardHeader><CardTitle>Streak</CardTitle></CardHeader><CardContent>{thisWeekInsights.currentStreak} days</CardContent></Card>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Last 7 days</CardTitle></CardHeader><CardContent>{last7DaysSeries.map((d) => `${d.date}: ${d.workedMinutes}m/${d.sessionCount}`).join(" | ") || "No data"}</CardContent></Card>
        <Card><CardHeader><CardTitle>Last 30 days daily</CardTitle></CardHeader><CardContent>{last30DaysSeries.map((d) => `${d.date}: ${d.workedMinutes}m/${d.sessionCount}`).join(" | ") || "No data"}</CardContent></Card>
        <Card><CardHeader><CardTitle>Project breakdown (30d)</CardTitle></CardHeader><CardContent>{last30Breakdown.length === 0 ? "No project data" : last30Breakdown.map((p) => `${p.projectName}: ${p.workedMinutes}m/${p.sessionCount}`).join(" | ")}</CardContent></Card>
        <Card><CardHeader><CardTitle>Insights</CardTitle></CardHeader><CardContent>Delta {thisWeekInsights.deltaMinutes}m · Best {thisWeekInsights.bestDay?.date ?? "n/a"} · Lowest {thisWeekInsights.lowestNonZeroDay?.date ?? "n/a"} · Avg {thisWeekInsights.averageSessionLength}m · Longest {thisWeekInsights.longestSession}m</CardContent></Card>
      </div>
    </AppShell>
  );
}
