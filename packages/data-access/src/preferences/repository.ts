import type {
  AuthenticatedActor,
  RepositoryResult,
  UserPreferencesRepository,
} from "@ega/application";
import { normalizeUserPreferences, type UserPreferences, type UserPreferencesPatch } from "@ega/domain/preferences";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeSupabaseError } from "../supabase/errors";

type UserPreferencesRow = {
  personal_operations: unknown;
  job_search_reference: unknown;
  theme: string | null;
  accent: string | null;
  density: string | null;
  reduced_motion: boolean | null;
  launch_page: string | null;
  task_layout: string | null;
  task_open_mode: string | null;
};

function isMissingPreferencesTable(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const message = typeof candidate?.message === "string" ? candidate.message : "";

  return (
    code === "42P01"
    || code === "PGRST205"
    || (/user_preferences/.test(message)
      && /does not exist|schema cache|could not find/i.test(message))
  );
}

function toPreferences(row: UserPreferencesRow): UserPreferences {
  return normalizeUserPreferences({
    personalOperations: row.personal_operations,
    jobSearchReference: row.job_search_reference,
    theme: row.theme ?? undefined,
    accent: row.accent ?? undefined,
    density: row.density ?? undefined,
    reducedMotion: typeof row.reduced_motion === "boolean" ? row.reduced_motion : undefined,
    launchPage: row.launch_page ?? undefined,
    taskLayout: row.task_layout ?? undefined,
    taskOpenMode: row.task_open_mode ?? undefined,
  });
}

/**
 * Supabase persistence for the owner's `user_preferences` row.
 *
 * The migration is additive. Until it is present in a deployment, reads fall
 * back to the documented defaults so the workspace keeps working. Writes fail
 * closed with an actionable error instead of pretending the preference saved.
 */
export class SupabaseUserPreferencesRepository implements UserPreferencesRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async get(actor: AuthenticatedActor): Promise<RepositoryResult<UserPreferences | null>> {
    const { data, error } = await this.supabase
      .from("user_preferences")
      .select(
        "theme, accent, density, reduced_motion, launch_page, task_layout, task_open_mode, personal_operations, job_search_reference",
      )
      .eq("user_id", actor.userId)
      .maybeSingle();

    if (error) {
      if (isMissingPreferencesTable(error)) {
        return { ok: true, value: null };
      }
      return { ok: false, error: sanitizeSupabaseError(error) };
    }

    if (!data) {
      return { ok: true, value: null };
    }

    return { ok: true, value: toPreferences(data as UserPreferencesRow) };
  }

  async patch(
    _actor: AuthenticatedActor,
    preferences: UserPreferencesPatch,
  ): Promise<RepositoryResult<UserPreferences>> {
    const { data, error } = await this.supabase.rpc("patch_user_preferences", { patch: preferences }).single();
    if (error) return { ok: false, error: sanitizeSupabaseError(error) };
    if (!data) return { ok: false, error: { code: "unknown" } };
    return { ok: true, value: toPreferences(data as UserPreferencesRow) };
  }
}
