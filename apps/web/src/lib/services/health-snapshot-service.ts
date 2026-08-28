import { createClient } from "@/lib/supabase/server";
import { getHealthWorkloadSnapshot, type HealthWorkloadSnapshot } from "@ega/application/health/workload-snapshot";
import { SupabaseExecutionEvidenceRepository, SupabaseTimeContextRepository } from "@ega/data-access";
import { createAuthenticatedActorFromIdentity } from "@ega/application";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type HealthSnapshotServiceResult =
  | { errorMessage: string | null; data: HealthWorkloadSnapshot }
  | { errorMessage: string; data: null };

export async function getHealthSnapshotData(options?: {
  supabase?: SupabaseClient;
  now?: Date;
  timezone?: string;
  includeOpenSessions?: boolean;
}): Promise<HealthSnapshotServiceResult> {
  const supabase = options?.supabase ?? (await createClient());
  const now = options?.now ?? new Date();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { errorMessage: "Authentication required.", data: null };
  }

  const actor = createAuthenticatedActorFromIdentity({ id: user.id, email: user.email ?? "" });

  // Use request-scoped client that carries the authenticated token so RLS applies.
  // createClient() already returns a scoped client when called from server components.
  const timeRepo = new SupabaseTimeContextRepository(supabase as unknown as import("@supabase/supabase-js").SupabaseClient);
  const evidenceRepo = new SupabaseExecutionEvidenceRepository(supabase as unknown as import("@supabase/supabase-js").SupabaseClient);

  const result = await getHealthWorkloadSnapshot(actor, timeRepo, evidenceRepo, {
    now,
    requestedTimezone: options?.timezone,
    includeOpenSessions: options?.includeOpenSessions,
  });

  if (!result.ok) {
    return { errorMessage: result.errorMessage, data: null };
  }

  return { errorMessage: null, data: result.data };
}
