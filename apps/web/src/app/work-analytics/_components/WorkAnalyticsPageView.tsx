import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDurationLabel } from "@/lib/task-session";
import { InteractiveAnalytics } from "../interactive-analytics";
import { AnalyticsFilters } from "../analytics-filters";
import type { WorkAnalyticsPageModel } from "../_lib/work-analytics-page-model";

export function WorkAnalyticsPageView({ model }: { model: WorkAnalyticsPageModel }) {
  if (model.error || !model.report) return <div className="p-6">{model.error ?? "Failed to load work analytics data."}</div>;
  const report = model.report;
  return (
    <>
      <div className="mb-6"><AnalyticsFilters /></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Today</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{formatDurationLabel(report.summary.todayWorkedMinutes * 60)}</div><div className="text-xs text-muted-foreground">{report.summary.todaySessionCount} sessions</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Yesterday</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{formatDurationLabel(report.yesterday.workedMinutes * 60)}</div><div className="text-xs text-muted-foreground">{report.yesterday.sessionCount} sessions</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Last 7 days</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{formatDurationLabel(report.summary.last7DaysWorkedMinutes * 60)}</div><div className="text-xs text-muted-foreground">{report.summary.last7DaysSessionCount} sessions</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Last 30 days</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{formatDurationLabel(report.summary.last30DaysWorkedMinutes * 60)}</div><div className="text-xs text-muted-foreground">{report.summary.last30DaysSessionCount} sessions</div></CardContent></Card>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Active days (30d)</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{report.summary.activeDays}</div><div className="text-xs text-muted-foreground">Avg {formatDurationLabel(report.summary.averageWorkPerActiveDayMinutes * 60)}/day</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Avg session</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{formatDurationLabel(report.summary.averageSessionLengthMinutes * 60)}</div><div className="text-xs text-muted-foreground">across {report.summary.last30DaysSessionCount} sessions</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Tasks completed</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{report.summary.completedTaskCount}</div><div className="text-xs text-muted-foreground">{report.summary.createdTaskCount} created, {report.summary.blockedTaskCount} blocked</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Streak</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{report.thisWeekInsights.currentStreak} days</div><div className="text-xs text-muted-foreground">current streak</div></CardContent></Card>
      </div>
      <InteractiveAnalytics drilldownIndexes={report.drilldownIndexes} last7DaysSeries={report.last7DaysSeries} last30DaysSeries={report.last30DaysSeries} breakdownBy={report.breakdownBy} breakdownTitle={report.breakdownTitle} projectBreakdown={report.projectBreakdown} goalBreakdown={report.goalBreakdown} taskBreakdown={report.taskBreakdown} insightsDeltaMinutes={report.thisWeekInsights.deltaMinutes} insightsBestDay={report.thisWeekInsights.bestDay?.date ?? null} insightsLowestDay={report.thisWeekInsights.lowestNonZeroDay?.date ?? null} insightsAvgSessionMinutes={report.thisWeekInsights.averageSessionLength} insightsLongestSessionMinutes={report.thisWeekInsights.longestSession} />
    </>
  );
}
