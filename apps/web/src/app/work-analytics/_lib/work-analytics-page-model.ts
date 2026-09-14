import { getCurrentUser } from "@/lib/services/auth-service";
import { getWorkAnalyticsSessionsForWindow, getWorkAnalyticsTaskCounts } from "@/lib/services/work-analytics-data-adapter";
import {
  computeEvidenceWindowForRange,
  computeLast30DaysWindow,
  computeWindowForRange,
  parseAnalyticsFilters,
} from "@/lib/services/work-analytics-filters";
import { buildWorkAnalyticsReport, type WorkAnalyticsTaskCounts } from "@/lib/services/work-analytics-report-builder";

const NO_TASK_COUNTS: WorkAnalyticsTaskCounts = {
  completedCount: 0,
  createdCount: 0,
  blockedCount: 0,
};

export async function getWorkAnalyticsPageModel(searchParams: Record<string, string | undefined>) {
  const user = await getCurrentUser();
  if (!user) return { user: null, error: "Please log in to view work analytics.", report: null as unknown as ReturnType<typeof buildWorkAnalyticsReport> };
  const filters = parseAnalyticsFilters(
    new URLSearchParams(Object.entries(searchParams).filter(([, v]) => v !== undefined) as [string, string][]),
  );
  const now = new Date();

  // Fetch one bounded evidence window covering the selected range, the fixed
  // 30-day context, and the previous calendar month. Selected-range metrics are
  // filtered to their exact canonical window inside the report builder.
  const selectedWindow = computeWindowForRange(filters.range, now);
  const evidenceWindow = computeEvidenceWindowForRange(filters.range, now);
  const last30Window = computeLast30DaysWindow(now);

  const [sessionsResult, selectedTaskCountsResult, last30TaskCountsResult] = await Promise.all([
    getWorkAnalyticsSessionsForWindow({ ownerUserId: user.id, window: evidenceWindow }),
    getWorkAnalyticsTaskCounts({ ownerUserId: user.id, window: selectedWindow }),
    getWorkAnalyticsTaskCounts({ ownerUserId: user.id, window: last30Window }),
  ]);

  if (sessionsResult.errorMessage || !sessionsResult.data)
    return { user, error: "Failed to load work analytics data.", report: null as unknown as ReturnType<typeof buildWorkAnalyticsReport> };

  const sessions = sessionsResult.data;
  const report = buildWorkAnalyticsReport(
    sessions,
    {
      selected: selectedTaskCountsResult.data ?? NO_TASK_COUNTS,
      last30d: last30TaskCountsResult.data ?? NO_TASK_COUNTS,
    },
    filters,
    now,
  );
  return { user, error: null as string | null, report, filters };
}

export type WorkAnalyticsPageModel = Awaited<ReturnType<typeof getWorkAnalyticsPageModel>>;
