import { createClient } from "@/lib/supabase/server";
import { getRequestTimeContextRepository } from "@/lib/request-time-context";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getHealthWorkloadSnapshot, type HealthWorkloadSnapshot } from "@ega/application/health/workload-snapshot";
import { getHealthRecommendations, type HealthRecommendation } from "@ega/application/health/recommendations";
import { SupabaseExecutionEvidenceRepository, SupabaseTimeContextRepository } from "@ega/data-access";
import { createAuthenticatedActorFromIdentity } from "@ega/application";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type HealthSnapshotServiceResult =
  | { errorMessage: string | null; data: HealthWorkloadSnapshot; recommendations: HealthRecommendation[] }
  | { errorMessage: string; data: null; recommendations: HealthRecommendation[] };

export async function getHealthSnapshotData(options?: {
  supabase?: SupabaseClient;
  now?: Date;
  timezone?: string;
  includeOpenSessions?: boolean;
}): Promise<HealthSnapshotServiceResult> {
  const supabase = options?.supabase ?? (await createClient());
  const now = options?.now ?? new Date();

  const user = await getCurrentUser(
    options?.supabase ? { supabase: options.supabase } : undefined,
  );

  if (!user) {
    return { errorMessage: "Authentication required.", data: null, recommendations: [] };
  }

  const actor = createAuthenticatedActorFromIdentity({ id: user.id, email: user.email ?? "" });

  // Use request-scoped client that carries the authenticated token so RLS applies.
  // createClient() already returns a scoped client when called from server components.
  const timeRepo = options?.supabase
    ? new SupabaseTimeContextRepository(supabase as unknown as import("@supabase/supabase-js").SupabaseClient)
    : await getRequestTimeContextRepository();
  const evidenceRepo = new SupabaseExecutionEvidenceRepository(supabase as unknown as import("@supabase/supabase-js").SupabaseClient);

  const result = await getHealthWorkloadSnapshot(actor, timeRepo, evidenceRepo, {
    now,
    requestedTimezone: options?.timezone,
    includeOpenSessions: options?.includeOpenSessions,
  });

  if (!result.ok) {
    return { errorMessage: result.errorMessage, data: null, recommendations: [] };
  }

  const recommendations = getHealthRecommendations(result.data);
  return { errorMessage: null, data: result.data, recommendations };
}
