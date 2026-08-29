import { createAuthenticatedActorFromIdentity, resolveFrictionEvidenceWindow } from "@ega/application";
import { getFrictionRadarReadModel } from "@ega/application/friction/stale-blocked-signals";
import { SupabaseExecutionEvidenceRepository, SupabaseFrictionRepository, SupabaseTimeContextRepository } from "@ega/data-access";
import { FRICTION_NEGLECTED_GOAL_WINDOW_DAYS } from "@ega/domain/friction";

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

  let evidenceWindow: { startIso: string; endIso: string };
  try {
    const tzRepo = new SupabaseTimeContextRepository(supabase as unknown as import("@supabase/supabase-js").SupabaseClient);
    const windowResult = await resolveFrictionEvidenceWindow(actor, tzRepo, { now });
    if (windowResult.ok) {
      evidenceWindow = { startIso: windowResult.data.startIso, endIso: windowResult.data.endIso };
    } else {
      throw new Error(windowResult.errorMessage);
    }
  } catch {
    const start = new Date(now.getTime() - FRICTION_NEGLECTED_GOAL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
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
