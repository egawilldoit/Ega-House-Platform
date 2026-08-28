import { createAuthenticatedActorFromIdentity } from "@ega/application";
import { getFrictionRadarReadModel } from "@ega/application/friction/stale-blocked-signals";
import { SupabaseFrictionRepository } from "@ega/data-access/friction";

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
  const result = await getFrictionRadarReadModel(actor, repository, {
    now: options?.now,
  });

  if (!result.ok) {
    return { data: null, errorMessage: result.errorMessage };
  }

  return { data: result.data, errorMessage: null };
}
