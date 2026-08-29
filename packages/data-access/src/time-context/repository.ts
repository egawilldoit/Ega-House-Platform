import type { AuthenticatedActor, RepositoryResult, TimeContextRepository } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeSupabaseError } from "../supabase/errors";

type TimeContextRow = {
  iana_timezone: string;
};

export class SupabaseTimeContextRepository implements TimeContextRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getTimezone(actor: AuthenticatedActor): Promise<RepositoryResult<string | null>> {
    const { data, error } = await this.supabase
      .from("user_time_context")
      .select("iana_timezone")
      .eq("user_id", actor.userId)
      .maybeSingle();

    if (error) {
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
