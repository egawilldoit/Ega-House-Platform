import { calculateWorkTargetProgress, type WorkTargetProgress } from "@ega/application";
import type { UserPreferences } from "@ega/domain/preferences";
import { getCurrentWeekWindow } from "@ega/domain/time-context";

import { getCurrentUser } from "@/lib/services/auth-service";
import type {
  ExecutionEvidenceSessionRow,
  ExecutionEvidenceWindow,
} from "@/lib/services/execution-evidence-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import { getWebUserPreferencesState } from "@/lib/services/user-preferences-service";
import { getWorkAnalyticsSessionsForWindow } from "@/lib/services/work-analytics-data-adapter";

/**
 * Web seam for work targets.
 *
 * Resolves the authenticated owner and their Time Context/preferences, loads
 * exactly one bounded current-week evidence window through the canonical work
 * analytics adapter, then delegates all semantics to the pure application
 * function. The week is never approximated from a recent-N session list.
 *
 * Failure behaviour: a failed session read returns `data: null` plus an
 * actionable message; it never returns a success-shaped empty report.
 */

export type SessionLoader = (args: {
  ownerUserId: string;
  window: ExecutionEvidenceWindow;
}) => Promise<{
  data: ExecutionEvidenceSessionRow[] | null;
  errorMessage: string | null;
}>;

export type PreferencesState = Readonly<{
  preferences: UserPreferences;
  errorMessage: string | null;
}>;

export type WorkTargetProgressDependencies = Readonly<{
  getCurrentUser?: () => Promise<{ id: string } | null>;
  getTimezone?: () => Promise<string>;
  getPreferencesState?: () => Promise<PreferencesState>;
  loadSessions?: SessionLoader;
}>;

export type WorkTargetProgressOptions = Readonly<{
  now?: Date;
  includeOpenSessions?: boolean;
  dependencies?: WorkTargetProgressDependencies;
}>;

export type WorkTargetProgressResult = Readonly<{
  data: WorkTargetProgress | null;
  errorMessage: string | null;
}>;

const LOAD_FAILURE = "Unable to load work targets right now.";
const PREFERENCES_FAILURE = "Unable to load personal targets right now.";

async function defaultTimezone(): Promise<string> {
  return (await getWebTimeContext()).timezone;
}

export async function getWorkTargetProgress(
  options: WorkTargetProgressOptions = {},
): Promise<WorkTargetProgressResult> {
  const dependencies = options.dependencies ?? {};

  try {
    const user = await (dependencies.getCurrentUser ?? getCurrentUser)();
    if (!user) {
      return { data: null, errorMessage: "Please log in to view work targets." };
    }

    // A Time Context failure degrades to UTC, matching the analytics report's
    // documented fallback, instead of hiding the whole targets section.
    let timezone = "UTC";
    try {
      timezone = await (dependencies.getTimezone ?? defaultTimezone)();
    } catch {
      timezone = "UTC";
    }

    // A read failure must not look like the documented defaults. Only an
    // absent row (errorMessage null) may legitimately fall back to defaults.
    let preferencesState: PreferencesState;
    try {
      preferencesState = await (dependencies.getPreferencesState ?? getWebUserPreferencesState)();
    } catch {
      return { data: null, errorMessage: PREFERENCES_FAILURE };
    }
    if (preferencesState.errorMessage) {
      return { data: null, errorMessage: PREFERENCES_FAILURE };
    }
    const preferences = preferencesState.preferences;

    const now = options.now ?? new Date();
    const week = getCurrentWeekWindow(timezone, now);
    const nowMs = now.getTime();
    const weekEndMs = Date.parse(week.weekEndExclusiveUtcIso);
    const boundedEndMs = Number.isFinite(weekEndMs) ? Math.min(nowMs, weekEndMs) : nowMs;
    const window: ExecutionEvidenceWindow = {
      startIso: week.weekStartUtcIso,
      endIso: new Date(boundedEndMs).toISOString(),
    };

    const sessionsResult = await (dependencies.loadSessions ?? getWorkAnalyticsSessionsForWindow)({
      ownerUserId: user.id,
      window,
    });

    if (sessionsResult.errorMessage || !sessionsResult.data) {
      return {
        data: null,
        errorMessage: sessionsResult.errorMessage ?? LOAD_FAILURE,
      };
    }

    try {
      const data = calculateWorkTargetProgress({
        sessions: sessionsResult.data,
        personalOperations: preferences.personalOperations,
        jobSearchReference: preferences.jobSearchReference,
        timezone,
        nowIso: now.toISOString(),
        includeOpenSessions: options.includeOpenSessions === true,
      });
      return { data, errorMessage: null };
    } catch {
      return { data: null, errorMessage: LOAD_FAILURE };
    }
  } catch {
    return { data: null, errorMessage: LOAD_FAILURE };
  }
}
