import {
  calculateWorkTargetProgress,
  createAuthenticatedActor,
  getEvidenceReview,
  type EvidenceReviewResult,
} from "@ega/application";
import {
  SupabaseDailyCheckinRepository,
  SupabaseExpenseRepository,
} from "@ega/data-access";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/services/auth-service";
import {
  getWorkAnalyticsSessionsForWindow,
} from "@/lib/services/work-analytics-data-adapter";
import type { ExecutionEvidenceWindow } from "@/lib/services/execution-evidence-service";
import { getWebUserPreferencesState } from "@/lib/services/user-preferences-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import { getWeekWindow } from "@ega/domain/time-context";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Two-week evidence review composition (PO-12, issue #353). Work/search
 * actuals come from the canonical session-backed progress over the requested
 * owner-local range; money and check-ins read the canonical stores. Any
 * unavailable source yields an honest null/absent section, never a zero.
 */
export async function getWebEvidenceReview(options: {
  startLocalDate?: string;
  endLocalDate?: string;
  supabase?: SupabaseServerClient;
}): Promise<{ data: EvidenceReviewResult | null; errorMessage: string | null }> {
  try {
    const supabase = options?.supabase ?? (await createClient());
    const user = await getCurrentUser();
    if (!user) return { data: null, errorMessage: "Sign in to load the evidence review." };

    const timeContext = options?.supabase
      ? null
      : await getWebTimeContext().catch(() => null);
    const timezone = timeContext?.timezone ?? "UTC";
    const localToday = timeContext?.localDate ?? new Date().toISOString().slice(0, 10);
    const endLocalDate = options?.endLocalDate ?? localToday;
    const startLocalDate =
      options?.startLocalDate ?? shiftIsoDate(endLocalDate, -13);

    const workProgress = async (
      _actor: { userId: string },
      start: string,
      end: string,
      tz: string,
    ) => {
      try {
        const preferencesState = await getWebUserPreferencesState();
        if (preferencesState.errorMessage) return null;
        const dayMs = 86_400_000;
        const startMs = Date.parse(`${start}T00:00:00Z`);
        const endMs = Date.parse(`${end}T00:00:00Z`);
        const window: ExecutionEvidenceWindow = {
          startIso: new Date(startMs - 86_400_000).toISOString(),
          endIso: new Date(endMs + dayMs + 86_400_000).toISOString(),
        };
        const sessionsResult = await getWorkAnalyticsSessionsForWindow({
          ownerUserId: user.id,
          window,
        });
        if (sessionsResult.errorMessage || !sessionsResult.data) return null;
        // calculateWorkTargetProgress computes one calendar week per call, so
        // aggregate per week covering the range (up to 35 days = 6 weeks).
        const firstMonday = getWeekWindow(tz, start).weekStart;
        const weeks: string[] = [];
        for (let monday = firstMonday; monday <= end; ) {
          weeks.push(monday);
          const next = new Date(Date.parse(`${monday}T00:00:00Z`) + 7 * dayMs)
            .toISOString()
            .slice(0, 10);
          monday = next;
          if (weeks.length > 7) break;
        }
        let trackedSeconds = 0;
        let jobSearchSeconds = 0;
        let workTarget = 0;
        let searchTarget = 0;
        let jobSearchConfigured = true;
        for (const monday of weeks) {
          const midWeekIso = new Date(Date.parse(`${monday}T00:00:00Z`) + 3 * dayMs).toISOString();
          const progress = calculateWorkTargetProgress({
            sessions: sessionsResult.data,
            personalOperations: preferencesState.preferences.personalOperations,
            jobSearchReference: preferencesState.preferences.jobSearchReference,
            timezone: tz,
            nowIso: midWeekIso,
          });
          jobSearchConfigured = progress.jobSearchConfigured;
          for (const day of progress.days) {
            if (day.date < start || day.date > end) continue;
            trackedSeconds += day.actualWorkMinutes * 60;
            jobSearchSeconds += day.actualJobSearchMinutes * 60;
            workTarget += day.targetWorkMinutes;
            searchTarget += day.targetJobSearchMinutes;
          }
        }
        // Search can never exceed the total: different reads could disagree
        // by rounding, so cap the subset to the tracked total.
        jobSearchSeconds = Math.min(jobSearchSeconds, trackedSeconds);
        return {
          trackedSeconds,
          jobSearchSeconds,
          workTargetMinutes: workTarget,
          jobSearchTargetMinutes: searchTarget,
          jobSearchConfigured,
        };
      } catch {
        return null;
      }
    };

    const result = await getEvidenceReview(
      createAuthenticatedActor(user.id),
      {
        checkins: new SupabaseDailyCheckinRepository(supabase),
        expenses: new SupabaseExpenseRepository(supabase),
      },
      { startLocalDate, endLocalDate, timezone, workProgress },
    );
    if (!result.ok) return { data: null, errorMessage: result.errorMessage };
    return { data: result.data, errorMessage: null };
  } catch {
    return { data: null, errorMessage: "The evidence review could not be loaded right now." };
  }
}

function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  return new Date(ms + deltaDays * 86_400_000).toISOString().slice(0, 10);
}
