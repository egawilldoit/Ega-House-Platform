import { getCurrentUser } from "@/lib/services/auth-service";
import { getWorkAnalyticsSessionsForWindow, getWorkAnalyticsTaskCounts } from "@/lib/services/work-analytics-data-adapter";
import {
  computeEvidenceWindowForRange,
  computeLast30DaysWindow,
  computeWindowForRange,
  parseAnalyticsFilters,
} from "@/lib/services/work-analytics-filters";
import { buildWorkAnalyticsReport, type WorkAnalyticsTaskCounts } from "@/lib/services/work-analytics-report-builder";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import { buildWorkActivityReadModel, type WorkActivityReadModel } from "@/lib/services/work-activity-read-model";

const NO_TASK_COUNTS: WorkAnalyticsTaskCounts = {
  completedCount: 0,
  createdCount: 0,
  blockedCount: 0,
};

export async function getWorkAnalyticsPageModel(searchParams: Record<string, string | undefined>) {
  const user = await getCurrentUser();
  if (!user) return { user: null, error: "Please log in to view work analytics.", report: null as unknown as ReturnType<typeof buildWorkAnalyticsReport>, workActivity: null as WorkActivityReadModel | null, workActivityError: null as string | null };
  const filters = parseAnalyticsFilters(
    new URLSearchParams(Object.entries(searchParams).filter(([, v]) => v !== undefined) as [string, string][]),
  );
  const now = new Date();

  // Analytics default to the owner's persisted EGA House timezone. A
  // data-access failure degrades to UTC windows rather than blocking the
  // report, and the UI surfaces the fallback via the Time Context.
  let analyticsTimezone: string | undefined;
  try {
    analyticsTimezone = (await getWebTimeContext()).timezone;
  } catch {
    analyticsTimezone = undefined;
  }

  // Fetch one bounded evidence window covering the selected range, the fixed
  // 30-day context, and the previous calendar month. Selected-range metrics are
  // filtered to their exact canonical window inside the report builder.
  const selectedWindow = computeWindowForRange(filters.range, now, analyticsTimezone);
  const evidenceWindow = computeEvidenceWindowForRange(filters.range, now, analyticsTimezone);
  const last30Window = computeLast30DaysWindow(now, analyticsTimezone);

  const [sessionsResult, selectedTaskCountsResult, last30TaskCountsResult, workActivityResult] = await Promise.all([
    getWorkAnalyticsSessionsForWindow({ ownerUserId: user.id, window: evidenceWindow }),
    getWorkAnalyticsTaskCounts({ ownerUserId: user.id, window: selectedWindow }),
    getWorkAnalyticsTaskCounts({ ownerUserId: user.id, window: last30Window }),
    buildWorkActivityReadModel({ ownerUserId: user.id, now }),
  ]);

  if (sessionsResult.errorMessage || !sessionsResult.data)
    return { user, error: "Failed to load work analytics data.", report: null as unknown as ReturnType<typeof buildWorkAnalyticsReport>, workActivity: null as WorkActivityReadModel | null, workActivityError: null as string | null };

  const sessions = sessionsResult.data;
  const report = buildWorkAnalyticsReport(
    sessions,
    {
      selected: selectedTaskCountsResult.data ?? NO_TASK_COUNTS,
      last30d: last30TaskCountsResult.data ?? NO_TASK_COUNTS,
    },
    filters,
    now,
    analyticsTimezone,
  );

  // The Work Activity calendar is a distinct section: a calendar read failure
  // must not take down the dominant analytics chart. Surface it as an
  // unavailable state instead of a fake healthy/empty one.
  const workActivityError = workActivityResult.errorMessage;
  return {
    user,
    error: null as string | null,
    report,
    filters,
    timezone: analyticsTimezone ?? null,
    workActivity: workActivityResult.data,
    workActivityError,
  };
}

export type WorkAnalyticsPageModel = Awaited<ReturnType<typeof getWorkAnalyticsPageModel>>;
