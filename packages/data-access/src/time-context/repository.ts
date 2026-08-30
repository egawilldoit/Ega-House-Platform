import type { AuthenticatedActor, RepositoryResult, TimeContextRepository } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeSupabaseError } from "../supabase/errors";

type TimeContextRow = {
  iana_timezone: string;
};

function isMissingTimeContextTable(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const message = typeof candidate?.message === "string" ? candidate.message : "";

  return (
    code === "42P01"
    || code === "PGRST205"
    || /user_time_context/.test(message) && /does not exist|schema cache|could not find/i.test(message)
  );
}

export class SupabaseTimeContextRepository implements TimeContextRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getTimezone(actor: AuthenticatedActor): Promise<RepositoryResult<string | null>> {
    const { data, error } = await this.supabase
      .from("user_time_context")
      .select("iana_timezone")
      .eq("user_id", actor.userId)
      .maybeSingle();

    if (error) {
      // The time-context migration is additive. Until it is present in a
      // deployment, Today can safely use the documented UTC fallback.
      if (isMissingTimeContextTable(error)) {
        return { ok: true, value: null };
      }
      return { ok: false, error: sanitizeSupabaseError(error) };
    }

    if (!data) {
      return { ok: true, value: null };
    }

    const row = data as TimeContextRow;
    const value = row.iana_timezone ? String(row.iana_timezone) : null;
    return { ok: true, value };
  }

  async setTimezone(
    actor: AuthenticatedActor,
    timezone: string,
  ): Promise<RepositoryResult<string>> {
    const { data, error } = await this.supabase
      .from("user_time_context")
      .upsert(
        {
          user_id: actor.userId,
          iana_timezone: timezone,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      )
      .select("iana_timezone")
      .single();

    if (error) {
      return { ok: false, error: sanitizeSupabaseError(error) };
    }

    const row = data as TimeContextRow | null;
    if (!row || !row.iana_timezone) {
      return { ok: false, error: { code: "unknown" } };
    }

    return { ok: true, value: String(row.iana_timezone) };
  }
}
