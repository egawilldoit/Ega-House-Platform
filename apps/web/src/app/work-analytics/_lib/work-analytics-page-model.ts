import { getCurrentUser } from "@/lib/services/auth-service";
import { getWorkAnalyticsSessionsForWindow, getWorkAnalyticsTaskCounts } from "@/lib/services/work-analytics-data-adapter";
import { parseAnalyticsFilters, computeWindowForRange } from "@/lib/services/work-analytics-filters";
import { buildWorkAnalyticsReport } from "@/lib/services/work-analytics-report-builder";

export async function getWorkAnalyticsPageModel(searchParams: Record<string, string | undefined>) {
  const user = await getCurrentUser();
  if (!user) return { user: null, error: "Please log in to view work analytics.", report: null as unknown as ReturnType<typeof buildWorkAnalyticsReport> };
  const filters = parseAnalyticsFilters(
    new URLSearchParams(Object.entries(searchParams).filter(([, v]) => v !== undefined) as [string, string][]),
  );
  const now = new Date();
  const primaryWindow = computeWindowForRange(filters.range, now);
  const sessionsResult = await getWorkAnalyticsSessionsForWindow({ ownerUserId: user.id, window: primaryWindow });
  if (sessionsResult.errorMessage || !sessionsResult.data)
    return { user, error: "Failed to load work analytics data.", report: null as unknown as ReturnType<typeof buildWorkAnalyticsReport> };
  const sessions = sessionsResult.data;
  const taskCountsResult = await getWorkAnalyticsTaskCounts({ ownerUserId: user.id, window: primaryWindow });
  const taskCounts = taskCountsResult.data ?? { completedCount: 0, createdCount: 0, blockedCount: 0 };
  const report = buildWorkAnalyticsReport(sessions, taskCounts, filters, now);
  return { user, error: null as string | null, report, filters };
}

export type WorkAnalyticsPageModel = Awaited<ReturnType<typeof getWorkAnalyticsPageModel>>;
