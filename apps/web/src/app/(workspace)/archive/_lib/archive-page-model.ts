import { createAuthenticatedActor, getArchiveReadModel } from "@ega/application";
import { SupabaseArchiveRepository } from "@ega/data-access";

import { requireAuthenticatedUser } from "@/lib/services/auth-service";
import { createClient } from "@/lib/supabase/server";

export type ArchiveSearchParams = {
  tab?: string;
  q?: string;
  archiveError?: string;
  archiveNotice?: string;
};

const MAX_FEEDBACK_LENGTH = 180;

/**
 * Server-side page model for the archive centre. Identity is derived from the
 * verified session; the repository is request-scoped so every read stays
 * inside the owner's RLS scope.
 */
export async function getArchivePageModel(searchParams: ArchiveSearchParams) {
  const supabase = await createClient();
  const user = await requireAuthenticatedUser({ supabase });
  const actor = createAuthenticatedActor(user.id);
  const repository = new SupabaseArchiveRepository(supabase);

  const result = await getArchiveReadModel(actor, repository, {
    tab: searchParams.tab,
    search: searchParams.q,
  });

  if (!result.ok) {
    throw new Error(result.errorMessage);
  }

  return {
    ...result.data,
    errorMessage: searchParams.archiveError?.slice(0, MAX_FEEDBACK_LENGTH) ?? null,
    notice:
      searchParams.archiveNotice === "restored"
        ? "Restored to the active workspace."
        : null,
  };
}

export type ArchivePageModel = Awaited<ReturnType<typeof getArchivePageModel>>;
