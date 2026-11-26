import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Atomic routine entry for the single `personal_expenses` ledger.
 *
 * The database function resolves the booking date's period (continuing the
 * calendar when the date is after the tracking window) and inserts the row in
 * the same transaction. A failed insert therefore rolls the continuation back;
 * a stale `period_id` can never be written by this path.
 */
export type RoutineMovementInsert = Readonly<{
  bookingDate: string;
  kind: string;
  direction: string;
  occurredAt: string | null;
  amountMinor: number;
  category: string | null;
  note: string | null;
  merchant: string | null;
  needVsWant: string | null;
  paymentMethod: string | null;
  purpose: string | null;
  countsInDaily: boolean;
  idempotencyKey: string;
  createFingerprint: string;
}>;

export type RoutineMovementWriteResult =
  | Readonly<{ ok: true; row: Record<string, unknown> }>
  | Readonly<{ ok: false; error: unknown }>;

export async function recordRoutineMovement(
  supabase: SupabaseClient,
  input: RoutineMovementInsert,
): Promise<RoutineMovementWriteResult> {
  const { data, error } = await supabase.rpc("money_record_routine_movement", {
    p_booking_date: input.bookingDate,
    p_kind: input.kind,
    p_direction: input.direction,
    p_occurred_at: input.occurredAt,
    p_amount_minor: input.amountMinor,
    p_category: input.category,
    p_note: input.note,
    p_merchant: input.merchant,
    p_need_vs_want: input.needVsWant,
    p_payment_method: input.paymentMethod,
    p_purpose: input.purpose,
    p_counts_in_daily: input.countsInDaily,
    p_idempotency_key: input.idempotencyKey,
    p_create_fingerprint: input.createFingerprint,
  });
  if (error) return { ok: false, error };
  const first = Array.isArray(data) ? data[0] : data;
  if (!first || typeof first !== "object" || Array.isArray(first)) {
    return { ok: false, error: null };
  }
  return { ok: true, row: first as Record<string, unknown> };
}
