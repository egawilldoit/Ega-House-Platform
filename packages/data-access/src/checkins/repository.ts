import type {
  AuthenticatedActor,
  DailyCheckinRepository,
} from "@ega/application";
import type { DailyCheckin } from "@ega/domain/checkins";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeSupabaseError } from "../supabase/errors";

/**
 * Request-scoped Supabase adapter for the canonical daily check-in store.
 * RLS remains authoritative; every statement also filters by the verified
 * actor's owner id as defense in depth. Rows are upserted by
 * (owner_user_id, local_date) so same-day retries produce one record.
 */

const TABLE = "daily_checkins";
const COLUMNS =
  "local_date, timezone, outcomes, personal_minutes, notes, overtime_minutes, overtime_reason, created_at, updated_at";

type DailyCheckinRow = {
  local_date: string;
  timezone: string;
  outcomes: string | null;
  personal_minutes: number | null;
  notes: string | null;
  overtime_minutes: number | null;
  overtime_reason: string | null;
  created_at: string;
  updated_at: string;
};

function toCheckin(row: DailyCheckinRow): DailyCheckin {
  return {
    localDate: row.local_date,
    timezone: row.timezone,
    outcomes: row.outcomes,
    personalMinutes: row.personal_minutes,
    notes: row.notes,
    overtimeMinutes: row.overtime_minutes,
    overtimeReason: row.overtime_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRow(record: DailyCheckin): DailyCheckinRow {
  return {
    local_date: record.localDate,
    timezone: record.timezone,
    outcomes: record.outcomes,
    personal_minutes: record.personalMinutes,
    notes: record.notes,
    overtime_minutes: record.overtimeMinutes,
    overtime_reason: record.overtimeReason,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

export class SupabaseDailyCheckinRepository implements DailyCheckinRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async get(actor: AuthenticatedActor, localDate: string) {
    const { data, error } = await this.supabase
      .from(TABLE)
      .select(COLUMNS)
      .eq("owner_user_id", actor.userId)
      .eq("local_date", localDate)
      .maybeSingle();
    if (error) {
      return { ok: false as const, error: sanitizeSupabaseError(error) };
    }
    if (!data) return { ok: true as const, value: null };
    return { ok: true as const, value: toCheckin(data as DailyCheckinRow) };
  }

  async listBetween(
    actor: AuthenticatedActor,
    startLocalDate: string,
    endLocalDate: string,
  ) {
    const { data, error } = await this.supabase
      .from(TABLE)
      .select(COLUMNS)
      .eq("owner_user_id", actor.userId)
      .gte("local_date", startLocalDate)
      .lte("local_date", endLocalDate)
      .order("local_date", { ascending: true });
    if (error) {
      return { ok: false as const, error: sanitizeSupabaseError(error) };
    }
    return {
      ok: true as const,
      value: ((data ?? []) as DailyCheckinRow[]).map(toCheckin),
    };
  }

  async save(actor: AuthenticatedActor, record: DailyCheckin) {
    const { data, error } = await this.supabase
      .from(TABLE)
      .upsert(
        { ...toRow(record), owner_user_id: actor.userId },
        { onConflict: "owner_user_id,local_date" },
      )
      .select(COLUMNS)
      .single();
    if (error) {
      return { ok: false as const, error: sanitizeSupabaseError(error) };
    }
    return { ok: true as const, value: toCheckin(data as DailyCheckinRow) };
  }
}
