import { SupabaseTimeContextRepository } from "@ega/data-access";
import { createAuthenticatedActor } from "@ega/application/auth/actor";
import { getLocalDayWindow } from "@ega/domain";

import { createClient } from "@/lib/supabase/server";
import {
  getWorkActivityCompletionEvents,
  getWorkActivitySessionsForYear,
} from "./work-activity-data-adapter";
import {
  buildWorkActivityCalendar,
  resolveWorkActivityYearWindow,
  type WorkActivityCalendar,
} from "./work-activity-service";

export type WorkActivityReadModel = {
  calendar: WorkActivityCalendar;
  timezone: string;
};

/**
 * Builds the Work Activity calendar read model for the authenticated owner.
 *
 * Resolves the account timezone through the canonical EGA-661 Time Context
 * seam (SupabaseTimeContextRepository), then runs one bounded yearly
 * overlapping-sessions query and one bounded completion-window query. All
 * local-day math happens in the pure `buildWorkActivityCalendar` seam — this
 * function owns no timezone or calendar policy of its own.
 */
export async function buildWorkActivityReadModel(args: {
  ownerUserId: string;
  now?: Date;
}): Promise<{ data: WorkActivityReadModel | null; errorMessage: string | null }> {
  const supabase = await createClient();

  const repo = new SupabaseTimeContextRepository(
    supabase as unknown as ConstructorParameters<typeof SupabaseTimeContextRepository>[0],
  );
  const actor = createAuthenticatedActor(args.ownerUserId);
  const tzResult = await repo.getTimezone(actor);
  if (!tzResult.ok) {
    return { data: null, errorMessage: "Unable to load your timezone preference." };
  }
  const timezone = tzResult.value && tzResult.value.trim() ? tzResult.value : "UTC";

  const now = args.now ?? new Date();
  const { startDate, endDate } = resolveWorkActivityYearWindow(timezone, now);
  const startWindow = getLocalDayWindow(timezone, startDate);
  const endWindow = getLocalDayWindow(timezone, endDate);
  const window = { startIso: startWindow.startUtcIso, endIso: endWindow.endUtcIso };
  const nowIso = now.toISOString();

  const [sessionsResult, completionsResult] = await Promise.all([
    getWorkActivitySessionsForYear({ ownerUserId: args.ownerUserId, window, supabase }),
    getWorkActivityCompletionEvents({ ownerUserId: args.ownerUserId, window, supabase }),
  ]);

  if (sessionsResult.errorMessage || !sessionsResult.data) {
    return { data: null, errorMessage: sessionsResult.errorMessage ?? "Failed to load sessions." };
  }
  if (completionsResult.errorMessage || !completionsResult.data) {
    return { data: null, errorMessage: completionsResult.errorMessage ?? "Failed to load completions." };
  }

  const calendar = buildWorkActivityCalendar({
    sessions: sessionsResult.data,
    completionEvents: completionsResult.data.map((event) => ({
      occurredAt: event.occurred_at,
    })),
    timezone,
    startDate,
    endDate,
    nowIso,
  });

  return { data: { calendar, timezone }, errorMessage: null };
}
