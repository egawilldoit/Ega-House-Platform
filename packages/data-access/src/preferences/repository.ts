import type {
  AuthenticatedActor,
  RepositoryResult,
  UserPreferencesRepository,
} from "@ega/application";
import { normalizeUserPreferences, type UserPreferences, type UserPreferencesPatch } from "@ega/domain/preferences";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeSupabaseError } from "../supabase/errors";

const PREFERENCES_SELECT =
  "theme, accent, density, reduced_motion, launch_page, task_layout, task_open_mode, personal_operations, job_search_reference";
// Pre-0089 deployment: the reference column does not exist yet. Reads retry
// without it and normalize the reference to null; writes still fail closed
// until the migration is applied.
const PREFERENCES_SELECT_WITHOUT_REFERENCE =
  "theme, accent, density, reduced_motion, launch_page, task_layout, task_open_mode, personal_operations";

type UserPreferencesRow = {
  personal_operations?: unknown;
  job_search_reference?: unknown;
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
    || (!/personal_operations/i.test(message) && /user_preferences/.test(message)
      && /does not exist|schema cache|could not find/i.test(message))
  );
}

function isMissingJobSearchReferenceColumn(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const message = typeof candidate?.message === "string" ? candidate.message : "";

  return (
    code === "42703"
    || code === "PGRST204"
    || (/job_search_reference/.test(message)
      && /does not exist|schema cache|could not find/i.test(message))
  );
}

function isMissingScheduleColumn(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  return (candidate?.code === "42703" || candidate?.code === "PGRST204")
    && typeof candidate.message === "string"
    && /personal_operations/i.test(candidate.message);
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
    const load = (select: string) =>
      this.supabase
        .from("user_preferences")
        .select(select)
        .eq("user_id", actor.userId)
        .maybeSingle();

    let { data, error } = await load(PREFERENCES_SELECT);
    if (error && isMissingJobSearchReferenceColumn(error)) {
      ({ data, error } = await load(PREFERENCES_SELECT_WITHOUT_REFERENCE));
    }

    if (error && isMissingScheduleColumn(error)) {
      ({ data, error } = await this.supabase
        .from("user_preferences")
        .select("theme, accent, density, reduced_motion, launch_page, task_layout, task_open_mode")
        .eq("user_id", actor.userId)
        .maybeSingle());
    }

    if (error) {
      if (isMissingPreferencesTable(error)) {
        return { ok: true, value: null };
      }
      return { ok: false, error: sanitizeSupabaseError(error) };
    }

    if (!data) {
      return { ok: true, value: null };
    }

    return { ok: true, value: toPreferences(data as unknown as UserPreferencesRow) };
  }

  async patch(
    _actor: AuthenticatedActor,
    preferences: UserPreferencesPatch,
  ): Promise<RepositoryResult<UserPreferences>> {
    // The RPC is authenticated by the request-scoped session (auth.uid()), so
    // the payload carries only the validated patch. PostgREST may hand back a
    // composite object or a one-element array; normalise both shapes instead of
    // depending on `.single()` to throw or coerce.
    const { data, error } = await this.supabase.rpc("patch_user_preferences", { patch: preferences });
    if (error) return { ok: false, error: sanitizeSupabaseError(error) };

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { ok: false, error: { code: "unknown" } };
    return { ok: true, value: toPreferences(row as UserPreferencesRow) };
  }
}
