import type {
  AuthenticatedActor,
  MoneyAggregate,
  MoneyAggregateQuery,
  MoneyCreateRecordInput,
  MoneyIdempotencyReceipt,
  MoneyListRecordQuery,
  MoneyPeriodRead,
  MoneyPeriodSnapshot,
  MoneyRepository,
  MoneyUpdateRecordInput,
  RepositoryFailure,
  RepositoryResult,
} from "@ega/application";
import {
  EXPENSE_CURRENCY,
  type ExpenseCategory,
  type ExpenseNeedVsWant,
  type ExpensePaymentMethod,
} from "@ega/domain/expenses";
import {
  isMoneyKind,
  type MoneyLedgerRow,
  type MoneyPurpose,
} from "@ega/domain/money";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isSupabaseUniqueConstraintViolation,
  sanitizeSupabaseError,
} from "../supabase/errors";

/**
 * Request-scoped Supabase adapter for the canonical money ledger.
 *
 * The table is the existing owner-scoped `personal_expenses` journal extended
 * additively by `0096_money_04_movements`. RLS remains authoritative and every
 * statement also filters the verified actor's owner id. Expense-only reads
 * deliberately stay on the existing `SupabaseExpenseRepository`, which filters
 * `kind = 'expense'`.
 */

const TABLE = "personal_expenses";
const PERIOD_TABLE = "money_periods";
const IDEMPOTENCY_CONSTRAINT = "personal_expenses_owner_idempotency_key_unique";

const MOVEMENT_COLUMNS =
  "id, kind, direction, occurred_at, booking_date, amount_minor, currency, category, note, merchant, need_vs_want, payment_method, purpose, counts_in_daily, period_id, idempotency_key, version, deleted_at, created_at, updated_at";

const MOVEMENT_COLUMNS_WITH_FINGERPRINT = `${MOVEMENT_COLUMNS}, create_fingerprint`;

type MovementRow = {
  id: string;
  kind: string;
  direction: string;
  occurred_at: string | null;
  booking_date: string;
  amount_minor: number;
  currency: string;
  category: string | null;
  note: string | null;
  merchant: string | null;
  need_vs_want: string | null;
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

type MovementIdempotencyRow = MovementRow & { create_fingerprint: string };

type MovementVersionRow = {
  version: number;
  deleted_at: string | null;
};

type PeriodRow = {
  id: string;
  start_date: string;
  end_date: string;
  currency: string;
  timezone: string;
  active_date: string;
  lifecycle: string;
  initialization: string;
  opening_movement_id: string | null;
  provenance: Record<string, unknown> | null;
  version: number;
};

type MoneySupabaseError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  constraint?: string;
} | null;

function moneyFailure(error: MoneySupabaseError): RepositoryFailure {
  if (!error) return { code: "unknown" };
  if (error.code === "42501") return { code: "forbidden" };
  if (error.code === "23505") return { code: "unknown" };
  return sanitizeSupabaseError(error, { conflictCode: "__none__" });
}

function toRecord(row: MovementRow): MoneyLedgerRow {
  if (!isMoneyKind(row.kind)) {
    throw new Error("personal_expenses row has an unsupported kind.");
  }
  return {
    id: String(row.id),
    kind: row.kind,
    direction: row.direction === "in" ? "in" : "out",
    amountMinor: Number(row.amount_minor),
    currency: EXPENSE_CURRENCY,
    category: row.category == null ? null : (String(row.category) as ExpenseCategory),
    note: row.note == null ? null : String(row.note),
    merchant: row.merchant == null ? null : String(row.merchant),
    needVsWant:
      row.need_vs_want == null
        ? null
        : (String(row.need_vs_want) as ExpenseNeedVsWant),
    paymentMethod:
      row.payment_method == null
        ? null
        : (String(row.payment_method) as ExpensePaymentMethod),
    purpose: row.purpose == null ? null : (String(row.purpose) as MoneyPurpose),
    countsInDaily: Boolean(row.counts_in_daily),
    bookingDate: String(row.booking_date),
    occurredAt: row.occurred_at == null ? null : String(row.occurred_at),
    periodId: row.period_id == null ? null : String(row.period_id),
    version: Number(row.version),
    deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toInsertPayload(
  actor: AuthenticatedActor,
  input: MoneyCreateRecordInput,
): Record<string, unknown> {
  const values = input.values;
  return {
    owner_user_id: actor.userId,
    kind: values.kind,
    direction: values.direction,
    occurred_at: values.occurredAt,
    booking_date: values.bookingDate,
    amount_minor: values.amountMinor,
    currency: EXPENSE_CURRENCY,
    category: values.category,
    note: values.note,
    merchant: values.merchant,
    need_vs_want: values.needVsWant,
    payment_method: values.paymentMethod,
    purpose: values.purpose,
    counts_in_daily: values.countsInDaily,
    period_id: input.periodId,
    idempotency_key: values.idempotencyKey,
    create_fingerprint: input.createFingerprint,
  };
}

function toUpdatePayload(input: MoneyUpdateRecordInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    updated_at: input.updatedAt,
    version: input.expectedVersion + 1,
  };
  const changes = input.changes;
  if (changes.bookingDate !== undefined) payload.booking_date = changes.bookingDate;
  if (changes.occurredAt !== undefined) payload.occurred_at = changes.occurredAt;
  if (changes.amountMinor !== undefined) payload.amount_minor = changes.amountMinor;
  if (changes.category !== undefined) payload.category = changes.category;
  if (changes.note !== undefined) payload.note = changes.note;
  if (changes.merchant !== undefined) payload.merchant = changes.merchant;
  if (changes.needVsWant !== undefined) payload.need_vs_want = changes.needVsWant;
  if (changes.paymentMethod !== undefined) payload.payment_method = changes.paymentMethod;
  if (changes.purpose !== undefined) payload.purpose = changes.purpose;
  if (changes.countsInDaily !== undefined) payload.counts_in_daily = changes.countsInDaily;
  return payload;
}

function isMissingPeriodTable(error: MoneySupabaseError): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    (/money_periods/.test(message) &&
      /does not exist|schema cache|could not find/i.test(message))
  );
}

export class SupabaseMoneyRepository implements MoneyRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async findByIdempotencyKey(
    actor: AuthenticatedActor,
    idempotencyKey: string,
  ): Promise<RepositoryResult<MoneyIdempotencyReceipt | null>> {
    const { data, error } = await this.supabase
      .from(TABLE)
      .select(MOVEMENT_COLUMNS_WITH_FINGERPRINT)
      .eq("owner_user_id", actor.userId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (error) return { ok: false, error: moneyFailure(error) };
    if (!data) return { ok: true, value: null };
    const row = data as MovementIdempotencyRow;
    return {
      ok: true,
      value: {
        movement: toRecord(row),
        createFingerprint: String(row.create_fingerprint),
      },
    };
  }

  async create(
    actor: AuthenticatedActor,
    input: MoneyCreateRecordInput,
  ): Promise<RepositoryResult<MoneyLedgerRow>> {
    const { data, error } = await this.supabase
      .from(TABLE)
      .insert(toInsertPayload(actor, input))
      .select(MOVEMENT_COLUMNS)
      .single();

    if (error) {
      if (isSupabaseUniqueConstraintViolation(error, IDEMPOTENCY_CONSTRAINT)) {
        return { ok: false, error: { code: "conflict" } };
      }
      return { ok: false, error: moneyFailure(error) };
    }
    if (!data) return { ok: false, error: { code: "unknown" } };
    return { ok: true, value: toRecord(data as MovementRow) };
  }

  async get(
    actor: AuthenticatedActor,
    id: string,
  ): Promise<RepositoryResult<MoneyLedgerRow | null>> {
    const { data, error } = await this.supabase
      .from(TABLE)
      .select(MOVEMENT_COLUMNS)
      .eq("owner_user_id", actor.userId)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) return { ok: false, error: moneyFailure(error) };
    if (!data) return { ok: true, value: null };
    return { ok: true, value: toRecord(data as MovementRow) };
  }

  async list(
    actor: AuthenticatedActor,
    query: MoneyListRecordQuery,
  ): Promise<RepositoryResult<MoneyLedgerRow[]>> {
    let request = this.supabase
      .from(TABLE)
      .select(MOVEMENT_COLUMNS)
      .eq("owner_user_id", actor.userId)
      .is("deleted_at", null);

    if (query.from) request = request.gte("booking_date", query.from);
    if (query.to) request = request.lte("booking_date", query.to);
    if (query.cutoff) request = request.lte("booking_date", query.cutoff);
    if (query.kind) request = request.eq("kind", query.kind);

    const { data, error } = await request
      .order("booking_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(query.offset, query.offset + query.limit - 1);

    if (error) return { ok: false, error: moneyFailure(error) };
    const rows = (data ?? []) as MovementRow[];
    return { ok: true, value: rows.map(toRecord) };
  }

  async update(
    actor: AuthenticatedActor,
    id: string,
    input: MoneyUpdateRecordInput,
  ): Promise<RepositoryResult<MoneyLedgerRow>> {
    const { data, error } = await this.supabase
      .from(TABLE)
      .update(toUpdatePayload(input))
      .eq("owner_user_id", actor.userId)
      .eq("id", id)
      .eq("version", input.expectedVersion)
      .is("deleted_at", null)
      .select(MOVEMENT_COLUMNS)
      .maybeSingle();

    if (error) return { ok: false, error: moneyFailure(error) };
    if (data) return { ok: true, value: toRecord(data as MovementRow) };

    const current = await this.supabase
      .from(TABLE)
      .select("version, deleted_at")
      .eq("owner_user_id", actor.userId)
      .eq("id", id)
      .maybeSingle();

    if (current.error) return { ok: false, error: moneyFailure(current.error) };
    if (!current.data) return { ok: false, error: { code: "notFound" } };
    const row = current.data as MovementVersionRow;
    if (row.deleted_at !== null) return { ok: false, error: { code: "notFound" } };
    return { ok: false, error: { code: "conflict" } };
  }

  /**
   * Bounded projection (kind/direction/amount/daily flag/date only) in pages
   * of 1000 up to 10000 rows. Reaching the cap reports `truncated`, which the
   * application turns into incomplete cash rather than a fake confirmed total.
   */
  async aggregate(
    actor: AuthenticatedActor,
    query: MoneyAggregateQuery,
  ): Promise<RepositoryResult<MoneyAggregate>> {
    const PAGE_SIZE = 1000;
    const MAX_ROWS = 10000;
    const rows: Array<{
      id: string;
      kind: string;
      direction: string;
      amount_minor: number;
      counts_in_daily: boolean;
      booking_date: string;
    }> = [];
    let truncated = false;

    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
      let request = this.supabase
        .from(TABLE)
        .select("id, kind, direction, amount_minor, counts_in_daily, booking_date")
        .eq("owner_user_id", actor.userId)
        .is("deleted_at", null)
        .lte("booking_date", query.cutoff);
      if (query.startDate) request = request.gte("booking_date", query.startDate);

      const { data, error } = await request
        .order("booking_date", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) return { ok: false, error: moneyFailure(error) };
      const page = (data ?? []) as typeof rows;
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
      if (rows.length >= MAX_ROWS) {
        truncated = true;
        break;
      }
    }

    return {
      ok: true,
      value: {
        rows: rows.map((row) => {
          if (!isMoneyKind(row.kind)) {
            throw new Error("personal_expenses row has an unsupported kind.");
          }
          return {
            id: String(row.id),
            kind: row.kind,
            direction: row.direction === "in" ? "in" : "out",
            amountMinor: Number(row.amount_minor),
            countsInDaily: Boolean(row.counts_in_daily),
            bookingDate: String(row.booking_date),
          };
        }),
        truncated,
      },
    };
  }

  /**
   * Defensive MONEY-03 dependency: `money_periods` is owned by the preceding
   * migration. Until it is present the read reports `available: false` so
   * MONEY-04 never invents period context; it does not create the table.
   */
  async getPeriod(
    actor: AuthenticatedActor,
    options: Readonly<{ periodId?: string | null }> = {},
  ): Promise<RepositoryResult<MoneyPeriodRead>> {
    let request = this.supabase
      .from(PERIOD_TABLE)
      .select(
        "id, start_date, end_date, currency, timezone, active_date, lifecycle, initialization, opening_movement_id, provenance, version",
      )
      .eq("owner_user_id", actor.userId);

    if (options.periodId) {
      request = request.eq("id", options.periodId);
    }

    const { data, error } = await request
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (isMissingPeriodTable(error)) {
        return { ok: true, value: { available: false, period: null } };
      }
      return { ok: false, error: moneyFailure(error) };
    }
    if (!data) return { ok: true, value: { available: true, period: null } };

    const row = data as PeriodRow;
    const lifecycle =
      row.lifecycle === "tracking" ||
      row.lifecycle === "ended" ||
      row.lifecycle === "rolled_over"
        ? row.lifecycle
        : "ended";
    const initialization =
      row.initialization === "uninitialized" ||
      row.initialization === "initialized" ||
      row.initialization === "reconciled"
        ? row.initialization
        : "uninitialized";
    const period: MoneyPeriodSnapshot = {
      id: String(row.id),
      startDate: String(row.start_date),
      endDate: String(row.end_date),
      currency: "MAD",
      timezone: String(row.timezone),
      activeDate: String(row.active_date),
      lifecycle,
      initialization,
      openingMovementId:
        row.opening_movement_id == null ? null : String(row.opening_movement_id),
      provenance:
        row.provenance && typeof row.provenance === "object"
          ? (row.provenance as Record<string, unknown>)
          : null,
      version: Number(row.version),
    };
    return { ok: true, value: { available: true, period } };
  }
}
