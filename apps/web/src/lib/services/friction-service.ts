import { createAuthenticatedActorFromIdentity } from "@ega/application";
import { getFrictionRadarReadModel } from "@ega/application/friction/stale-blocked-signals";
import { SupabaseExecutionEvidenceRepository, SupabaseFrictionRepository, SupabaseTimeContextRepository } from "@ega/data-access";
import { getLocalDateInTimezone, getWeekWindow } from "@ega/domain/time-context";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/services/auth-service";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export async function getFrictionRadar(options?: {
  supabase?: SupabaseServerClient;
  now?: Date;
}) {
  const supabase = options?.supabase ?? (await createClient());
  const user = await getCurrentUser({ supabase });
  if (!user) {
    return { data: null, errorMessage: "Authentication required." as const };
  }

  const actor = createAuthenticatedActorFromIdentity({ id: user.id });
  const repository = new SupabaseFrictionRepository(supabase);
  const now = options?.now ?? new Date();

  let timezone = "UTC";
  try {
    const tzRepo = new SupabaseTimeContextRepository(supabase as unknown as import("@supabase/supabase-js").SupabaseClient);
    const tzResult = await tzRepo.getTimezone(actor);
    if (tzResult.ok && tzResult.value) timezone = String(tzResult.value).trim() || "UTC";
  } catch {
    // fallback UTC
  }

  let evidenceWindow: { startIso: string; endIso: string };
  try {
    const localDate = getLocalDateInTimezone(now, timezone);
    const week = getWeekWindow(timezone, localDate);
    evidenceWindow = { startIso: week.weekStartUtcIso, endIso: now.toISOString() };
  } catch {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    evidenceWindow = { startIso: start.toISOString(), endIso: now.toISOString() };
  }

  const result = await getFrictionRadarReadModel(actor, repository, {
    now,
    evidence: {
      window: evidenceWindow,
      repository: new SupabaseExecutionEvidenceRepository(supabase as unknown as import("@supabase/supabase-js").SupabaseClient),
      includeOpenSessions: false,
      nowIso: now.toISOString(),
    },
  });

  if (!result.ok) {
    return { data: null, errorMessage: result.errorMessage };
  }

  return { data: result.data, errorMessage: null };
}
