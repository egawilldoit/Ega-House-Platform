import type {
  AuthenticatedActor,
  ExpenseCreateRecordInput,
  ExpenseDeleteOutcome,
  ExpenseIdempotencyReceipt,
  ExpenseListRecordQuery,
  ExpenseRepository,
  ExpenseSummary,
  ExpenseSummaryWindow,
  ExpenseUpdateRecordInput,
  RepositoryFailure,
  RepositoryResult,
} from "@ega/application";
import {
  EXPENSE_CURRENCY,
  type ExpenseCategory,
  type ExpenseNeedVsWant,
  type ExpensePaymentMethod,
  type PersonalExpense,
} from "@ega/domain/expenses";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isSupabaseUniqueConstraintViolation,
  sanitizeSupabaseError,
} from "../supabase/errors";

/**
 * Request-scoped Supabase adapter for the owner-scoped personal expense
 * ledger. RLS remains authoritative; every statement also filters by the
 * verified actor's owner id as defense in depth. Soft-deleted rows are
 * excluded from normal reads and list/total queries.
 */

const TABLE = "personal_expenses";
const IDEMPOTENCY_CONSTRAINT = "personal_expenses_owner_idempotency_key_unique";

const EXPENSE_COLUMNS =
  "id, kind, direction, occurred_at, booking_date, amount_minor, currency, category, note, merchant, need_vs_want, payment_method, purpose, counts_in_daily, period_id, idempotency_key, version, deleted_at, created_at, updated_at";

const EXPENSE_COLUMNS_WITH_FINGERPRINT =
  "id, kind, direction, occurred_at, booking_date, amount_minor, currency, category, note, merchant, need_vs_want, payment_method, purpose, counts_in_daily, period_id, idempotency_key, version, deleted_at, created_at, updated_at, create_fingerprint";

type ExpenseRow = {
  id: string;
  kind: string;
  direction: string;
  occurred_at: string | null;
  booking_date: string;
  amount_minor: number;
  currency: string;
  category: string;
  note: string | null;
  merchant: string | null;
  need_vs_want: string;
  payment_method: string | null;
  purpose: string | null;
  counts_in_daily: boolean;
  period_id: string | null;
  idempotency_key: string;
  version: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

type ExpenseIdempotencyRow = ExpenseRow & {
  create_fingerprint: string;
};

type ExpenseSupabaseError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  constraint?: string;
} | null;

/**
 * Expense-local persistence failure mapping. Permission failures become
 * `forbidden`; unique violations other than the explicitly handled
 * owner+idempotency receipt stay `unknown` instead of looking like a replay
 * conflict. The shared sanitizer default is intentionally unchanged.
 */
function expenseFailure(error: ExpenseSupabaseError): RepositoryFailure {
  if (!error) return { code: "unknown" };
  if (error.code === "42501") return { code: "forbidden" };
  if (error.code === "23505") return { code: "unknown" };
  return sanitizeSupabaseError(error, { conflictCode: "__none__" });
}

type ExpenseVersionRow = {
  version: number;
  deleted_at: string | null;
};

function toRecord(row: ExpenseRow): PersonalExpense {
  return {
    id: String(row.id),
    kind: "expense",
    direction: "out",
    occurredAt: row.occurred_at == null ? null : String(row.occurred_at),
    bookingDate: String(row.booking_date),
    amountMinor: Number(row.amount_minor),
    currency: EXPENSE_CURRENCY,
    category: String(row.category) as ExpenseCategory,
    note: row.note == null ? null : String(row.note),
    merchant: row.merchant == null ? null : String(row.merchant),
    needVsWant: String(row.need_vs_want) as ExpenseNeedVsWant,
    paymentMethod:
      row.payment_method == null
        ? null
        : (String(row.payment_method) as ExpensePaymentMethod),
    purpose: row.purpose == null ? null : (String(row.purpose) as PersonalExpense["purpose"]),
    countsInDaily: Boolean(row.counts_in_daily),
    periodId: row.period_id == null ? null : String(row.period_id),
    idempotencyKey: String(row.idempotency_key),
    version: Number(row.version),
    deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toInsertPayload(
  actor: AuthenticatedActor,
  input: ExpenseCreateRecordInput,
): Record<string, unknown> {
  const values = input.values;
  return {
    owner_user_id: actor.userId,
    kind: "expense",
    direction: "out",
    occurred_at: values.occurredAt,
    // booking_date is derived by the DB in the owner/period timezone.
    amount_minor: values.amountMinor,
    currency: EXPENSE_CURRENCY,
    category: values.category,
    note: values.note,
    merchant: values.merchant,
    need_vs_want: values.needVsWant,
    payment_method: values.paymentMethod,
    purpose: null,
    counts_in_daily: true,
    period_id: null,
    idempotency_key: values.idempotencyKey,
    create_fingerprint: input.createFingerprint,
  };
}

function toUpdatePayload(
  input: ExpenseUpdateRecordInput,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    updated_at: input.updatedAt,
    version: input.expectedVersion + 1,
  };
  const changes = input.changes;
  if (changes.occurredAt !== undefined) payload.occurred_at = changes.occurredAt;
  // A timestamp change re-derives booking_date in the DB (owner/period zone).
  // A date-only change writes the explicit day.
  else if (changes.bookingDate !== undefined) payload.booking_date = changes.bookingDate;
  if (changes.amountMinor !== undefined) payload.amount_minor = changes.amountMinor;
  if (changes.category !== undefined) payload.category = changes.category;
  if (changes.note !== undefined) payload.note = changes.note;
  if (changes.merchant !== undefined) payload.merchant = changes.merchant;
  if (changes.needVsWant !== undefined) payload.need_vs_want = changes.needVsWant;
  if (changes.paymentMethod !== undefined) {
    payload.payment_method = changes.paymentMethod;
  }
  if (changes.purpose !== undefined) payload.purpose = changes.purpose;
  if (changes.countsInDaily !== undefined) {
    payload.counts_in_daily = changes.countsInDaily;
  }
  return payload;
}

export class SupabaseExpenseRepository implements ExpenseRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async findByIdempotencyKey(
    actor: AuthenticatedActor,
    idempotencyKey: string,
  ): Promise<RepositoryResult<ExpenseIdempotencyReceipt | null>> {
    const { data, error } = await this.supabase
      .from(TABLE)
      .select(EXPENSE_COLUMNS_WITH_FINGERPRINT)
      .eq("owner_user_id", actor.userId)
      .eq("kind", "expense")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (error) return { ok: false, error: expenseFailure(error) };
    if (!data) return { ok: true, value: null };
    const row = data as ExpenseIdempotencyRow;
    return {
      ok: true,
      value: {
        expense: toRecord(row),
        createFingerprint: String(row.create_fingerprint),
      },
    };
  }

  async create(
    actor: AuthenticatedActor,
    input: ExpenseCreateRecordInput,
  ): Promise<RepositoryResult<PersonalExpense>> {
    const { data, error } = await this.supabase
      .from(TABLE)
      .insert(toInsertPayload(actor, input))
      .select(EXPENSE_COLUMNS)
      .single();

    if (error) {
      if (isSupabaseUniqueConstraintViolation(error, IDEMPOTENCY_CONSTRAINT)) {
        return { ok: false, error: { code: "conflict" } };
      }
      return { ok: false, error: expenseFailure(error) };
    }
    if (!data) return { ok: false, error: { code: "unknown" } };
    return { ok: true, value: toRecord(data as ExpenseRow) };
  }

  async get(
    actor: AuthenticatedActor,
    id: string,
  ): Promise<RepositoryResult<PersonalExpense | null>> {
    const { data, error } = await this.supabase
      .from(TABLE)
      .select(EXPENSE_COLUMNS)
      .eq("owner_user_id", actor.userId)
      .eq("kind", "expense")
      .eq("id", id)
      .eq("kind", "expense")
      .is("deleted_at", null)
      .maybeSingle();

    if (error) return { ok: false, error: expenseFailure(error) };
    if (!data) return { ok: true, value: null };
    return { ok: true, value: toRecord(data as ExpenseRow) };
  }

  async list(
    actor: AuthenticatedActor,
    query: ExpenseListRecordQuery,
  ): Promise<RepositoryResult<PersonalExpense[]>> {
    let request = this.supabase
      .from(TABLE)
      .select(EXPENSE_COLUMNS)
      .eq("owner_user_id", actor.userId)
      .eq("kind", "expense")
      .is("deleted_at", null);

    // Dated reads use the resolved owner-local booking day so date-only rows
    // are included and timestamped rows cannot shift by timezone.
    if (query.startBookingDate) {
      request = request.gte("booking_date", query.startBookingDate);
    } else if (query.startUtcIso) {
      request = request.gte("occurred_at", query.startUtcIso);
    }
    if (query.endBookingDateExclusive) {
      request = request.lt("booking_date", query.endBookingDateExclusive);
    } else if (query.endUtcExclusiveIso) {
      request = request.lt("occurred_at", query.endUtcExclusiveIso);
    }
    // Keyset continuation keeps an export from shifting under concurrent
    // inserts/deletes. Booking-date windows use a booking-date cursor so
    // date-only rows (null occurred_at) are still reachable.
    const byBookingDate = Boolean(
      query.startBookingDate || query.endBookingDateExclusive,
    );
    if (byBookingDate && query.beforeBookingDate && query.beforeId) {
      request = request.or(
        `booking_date.lt.${query.beforeBookingDate},and(booking_date.eq.${query.beforeBookingDate},id.lt.${query.beforeId})`,
      );
    } else if (!byBookingDate && query.beforeOccurredAt && query.beforeId) {
      request = request.or(
        `occurred_at.lt.${query.beforeOccurredAt},and(occurred_at.eq.${query.beforeOccurredAt},id.lt.${query.beforeId})`,
      );
    }

    const { data, error } = await request
      .order(byBookingDate ? "booking_date" : "occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .range(query.offset, query.offset + query.limit - 1);

    if (error) return { ok: false, error: expenseFailure(error) };
    const rows = (data ?? []) as ExpenseRow[];
    return { ok: true, value: rows.map(toRecord) };
  }

  async update(
    actor: AuthenticatedActor,
    id: string,
    input: ExpenseUpdateRecordInput,
  ): Promise<RepositoryResult<PersonalExpense>> {
    const { data, error } = await this.supabase
      .from(TABLE)
      .update(toUpdatePayload(input))
      .eq("owner_user_id", actor.userId)
      .eq("kind", "expense")
      .eq("id", id)
      .eq("kind", "expense")
      .eq("version", input.expectedVersion)
      .is("deleted_at", null)
      .select(EXPENSE_COLUMNS)
      .maybeSingle();

    if (error) return { ok: false, error: expenseFailure(error) };
    if (data) return { ok: true, value: toRecord(data as ExpenseRow) };

    // No row matched: distinguish a missing/deleted expense from a stale
    // version so the transport can answer 404 vs 409 accurately.
    const current = await this.supabase
      .from(TABLE)
      .select("version, deleted_at")
      .eq("owner_user_id", actor.userId)
      .eq("kind", "expense")
      .eq("id", id)
      .eq("kind", "expense")
      .maybeSingle();

    if (current.error) {
      return { ok: false, error: expenseFailure(current.error) };
    }
    if (!current.data) return { ok: false, error: { code: "notFound" } };
    const row = current.data as ExpenseVersionRow;
    if (row.deleted_at !== null) return { ok: false, error: { code: "notFound" } };
    return { ok: false, error: { code: "conflict" } };
  }

  /**
   * Bounded server-side summary: pages of at most 1000 compact rows
   * (category + amount only) up to a hard cap of 10000 rows. Reaching the
   * cap reports `truncated` so callers show a lower bound, never a fake
   * complete total.
   */
  async summarize(
    actor: AuthenticatedActor,
    window: ExpenseSummaryWindow,
  ): Promise<RepositoryResult<ExpenseSummary>> {
    const PAGE_SIZE = 1000;
    const MAX_ROWS = 10000;
    const totals: Partial<Record<ExpenseCategory, number>> = {};
    const counts: Partial<Record<ExpenseCategory, number>> = {};
    let recordCount = 0;
    let truncated = false;

    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
      let request = this.supabase
        .from(TABLE)
        .select("category, amount_minor")
        .eq("owner_user_id", actor.userId)
        .eq("kind", "expense")
        .is("deleted_at", null);
      request = window.startBookingDate
        ? request.gte("booking_date", window.startBookingDate)
        : request.gte("occurred_at", window.startUtcIso);
      request = window.endBookingDateExclusive
        ? request.lt("booking_date", window.endBookingDateExclusive)
        : request.lt("occurred_at", window.endUtcExclusiveIso);
      const { data, error } = await request
        .order("occurred_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) return { ok: false, error: expenseFailure(error) };
      const rows = (data ?? []) as Array<{ category: string; amount_minor: number }>;
      for (const row of rows) {
        const category = row.category as ExpenseCategory;
        totals[category] = (totals[category] ?? 0) + row.amount_minor;
        counts[category] = (counts[category] ?? 0) + 1;
        recordCount += 1;
      }
      if (rows.length < PAGE_SIZE) break;
      if (recordCount >= MAX_ROWS) {
        truncated = true;
        break;
      }
    }

    return { ok: true, value: { totalsByCategory: totals, countsByCategory: counts, recordCount, truncated } };
  }

  async count(
    actor: AuthenticatedActor,
    window: ExpenseSummaryWindow,
  ): Promise<RepositoryResult<number>> {
    let request = this.supabase
      .from(TABLE)
      .select("id", { count: "exact", head: true })
      .eq("owner_user_id", actor.userId)
      .eq("kind", "expense")
      .is("deleted_at", null);
    request = window.startBookingDate
      ? request.gte("booking_date", window.startBookingDate)
      : request.gte("occurred_at", window.startUtcIso);
    request = window.endBookingDateExclusive
      ? request.lt("booking_date", window.endBookingDateExclusive)
      : request.lt("occurred_at", window.endUtcExclusiveIso);
    const { count, error } = await request;

    if (error) return { ok: false, error: expenseFailure(error) };
    if (typeof count !== "number") return { ok: false, error: { code: "unknown" } };
    return { ok: true, value: count };
  }

  async softDelete(
    actor: AuthenticatedActor,
    id: string,
    nowIso: string,
    expectedVersion?: number,
  ): Promise<RepositoryResult<ExpenseDeleteOutcome>> {
    const current = await this.supabase
      .from(TABLE)
      .select("version, deleted_at")
      .eq("owner_user_id", actor.userId)
      .eq("kind", "expense")
      .eq("id", id)
      .eq("kind", "expense")
      .maybeSingle();

    if (current.error) {
      return { ok: false, error: expenseFailure(current.error) };
    }
    if (!current.data) return { ok: false, error: { code: "notFound" } };

    const row = current.data as ExpenseVersionRow;
    if (row.deleted_at !== null) {
      // A repeat delete stays an idempotent success even when a caller pinned
      // an older version: the row is already in the requested terminal state.
      return {
        ok: true,
        value: {
          id,
          deletedAt: String(row.deleted_at),
          alreadyDeleted: true,
        },
      };
    }
    if (expectedVersion !== undefined && Number(row.version) !== expectedVersion) {
      return { ok: false, error: { code: "conflict" } };
    }

    const { data, error } = await this.supabase
      .from(TABLE)
      .update({
        deleted_at: nowIso,
        updated_at: nowIso,
        version: Number(row.version) + 1,
      })
      .eq("owner_user_id", actor.userId)
      .eq("kind", "expense")
      .eq("id", id)
      .eq("kind", "expense")
      .eq("version", row.version)
      .is("deleted_at", null)
      .select("id, deleted_at")
      .maybeSingle();

    if (error) return { ok: false, error: expenseFailure(error) };
    if (data) {
      const deleted = data as { id: string; deleted_at: string };
      return {
        ok: true,
        value: {
          id: String(deleted.id),
          deletedAt: String(deleted.deleted_at),
          alreadyDeleted: false,
        },
      };
    }

    // The row changed between read and write. Re-read to classify a concurrent
    // delete (idempotent success) versus a version race (conflict).
    const raced = await this.supabase
      .from(TABLE)
      .select("version, deleted_at")
      .eq("owner_user_id", actor.userId)
      .eq("kind", "expense")
      .eq("id", id)
      .eq("kind", "expense")
      .maybeSingle();
    if (raced.error) {
      return { ok: false, error: expenseFailure(raced.error) };
    }
    if (!raced.data) return { ok: false, error: { code: "notFound" } };
    const racedRow = raced.data as ExpenseVersionRow;
    if (racedRow.deleted_at !== null) {
      return {
        ok: true,
        value: {
          id,
          deletedAt: String(racedRow.deleted_at),
          alreadyDeleted: true,
        },
      };
    }
    return { ok: false, error: { code: "conflict" } };
  }
}
