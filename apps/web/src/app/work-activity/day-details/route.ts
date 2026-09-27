import { SupabaseTimeContextRepository } from "@ega/data-access";
import { createAuthenticatedActor } from "@ega/application/auth/actor";
import { getLocalDayWindow } from "@ega/domain";

import { createClient } from "@/lib/supabase/server";
import { getWorkActivityDayDetails } from "@/lib/services/work-activity-data-adapter";

export const dynamic = "force-dynamic";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /work-activity/day-details?date=YYYY-MM-DD
 *
 * Bounded day detail for the Work Activity calendar drilldown. Returns the
 * sessions and completed Tasks for one account-local day. The query is bounded
 * to the selected local day window — never a yearly or per-day N+1 query.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const dateParam = new URL(request.url).searchParams.get("date") ?? "";
  if (!ISO_DATE_RE.test(dateParam)) {
    return Response.json(
      { error: "Invalid date. Expected YYYY-MM-DD." },
      { status: 400 },
    );
  }

  const repo = new SupabaseTimeContextRepository(
    supabase as unknown as ConstructorParameters<typeof SupabaseTimeContextRepository>[0],
  );
  const actor = createAuthenticatedActor(user.id);
  const tzResult = await repo.getTimezone(actor);
  if (!tzResult.ok) {
    return Response.json(
      { error: "Unable to load your timezone preference." },
      { status: 500 },
    );
  }
  const timezone = tzResult.value && tzResult.value.trim() ? tzResult.value : "UTC";

  let dayWindow: { startIso: string; endIso: string };
  try {
    const window = getLocalDayWindow(timezone, dateParam);
    dayWindow = { startIso: window.startUtcIso, endIso: window.endUtcIso };
  } catch {
    return Response.json(
      { error: "Invalid date. Expected YYYY-MM-DD." },
      { status: 400 },
    );
  }

  const result = await getWorkActivityDayDetails({
    ownerUserId: user.id,
    dayWindow,
    supabase,
  });

  if (result.errorMessage || !result.data) {
    return Response.json(
      { error: result.errorMessage ?? "Failed to load day details." },
      { status: 500 },
    );
  }

  return Response.json({
    date: dateParam,
    timezone,
    sessions: result.data.sessions,
    completedTasks: result.data.completedTasks,
  });
}
