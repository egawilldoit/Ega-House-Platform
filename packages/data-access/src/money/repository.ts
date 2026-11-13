import type {
  AuthenticatedActor,
  MoneyAggregate,
  MoneyAggregateQuery,
  MoneyCreateRecordInput,
  MoneyDayCloseAttempt,
  MoneyDayCloseCurrentTotals,
  MoneyDayCloseRecordInput,
  MoneyIdempotencyReceipt,
  MoneyLedgerDirectionTotals,
  MoneyLedgerOverview,
  MoneyLedgerWindow,
  MoneyListRecordQuery,
  MoneyMovementRepository,
  MoneyPeriodCreateRecordInput,
  MoneyPeriodRepository,
  MoneyPeriodUpdateRecordInput,
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
  type MoneyDayClose,
  type MoneyLedgerRow,
  type MoneyOpening,
  type MoneyOpeningCorrection,
  type MoneyOpeningProvenance,
  type MoneyPeriod,
  type MoneyPeriodInitialization,
  type MoneyPeriodLifecycle,
  type MoneyPeriodProvenance,
  type MoneyPeriodSettings,
  type MoneyPurpose,
} from "@ega/domain/money";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isSupabaseUniqueConstraintViolation,
  sanitizeSupabaseError,
} from "../supabase/errors";

/**
 * Request-scoped Supabase adapters for Money.
 *
 * Two clearly named classes share one module and the one ledger table:
 * `SupabaseMoneyPeriodRepository` owns period/opening state (MONEY-03) and
 * `SupabaseMoneyRepository` owns movement rows (MONEY-04). RLS remains
 * authoritative; every statement also filters the verified actor's owner id as
 * defense in depth. Expense-only reads deliberately stay on the existing
 * `SupabaseExpenseRepository`, which filters `kind = 'expense'`.
 */

const PERIOD_TABLE = "money_periods";
const LEDGER_TABLE = "personal_expenses";
const IDEMPOTENCY_CONSTRAINT = "personal_expenses_owner_idempotency_key_unique";

// PostgREST may cap a single response below the requested range (the common
// `db-max-rows` default is 1000), so completeness is proven by paging until a
// short page, never by assuming one `limit` returned every row.
const LEDGER_PAGE_SIZE = 1_000;
const LEDGER_PAGED_MAX_ROWS = 100_000;

const PERIOD_COLUMNS =
  "id, owner_user_id, start_date, end_date, currency, timezone, active_date, lifecycle, initialization, opening_movement_id, provenance, settings, version, created_at, updated_at";

const OPENING_COLUMNS =
  "id, amount_minor, currency, booking_date, version, created_at, updated_at";

const MOVEMENT_COLUMNS =
  "id, kind, direction, occurred_at, booking_date, amount_minor, currency, category, note, merchant, need_vs_want, payment_method, purpose, counts_in_daily, period_id, idempotency_key, version, deleted_at, created_at, updated_at";

const MOVEMENT_COLUMNS_WITH_FINGERPRINT = `${MOVEMENT_COLUMNS}, create_fingerprint`;

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
  if (
    error.code === "23505" ||
    error.code === "23503" ||
    error.code === "23514" ||
    error.code === "23P01"
  ) {
    return { code: "conflict" };
  }
  return sanitizeSupabaseError(error, { conflictCode: "__none__" });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    const first = data[0];
    return isRecord(first) ? first : null;
  }
  return isRecord(data) ? data : null;
}

// ---------------------------------------------------------------------------
// Period and opening state (MONEY-03)
// ---------------------------------------------------------------------------

type PeriodRow = {
  id: string;
  owner_user_id: string;
  start_date: string;
  end_date: string;
  currency: string;
  timezone: string;
  active_date: string;
  lifecycle: string;
  initialization: string;
  opening_movement_id: string | null;
  provenance: unknown;
  settings: unknown;
  version: number;
  created_at: string;
  updated_at: string;
};

type OpeningRow = {
  id: string;
  amount_minor: number;
  currency: string;
  booking_date: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

function toCorrections(value: unknown): MoneyOpeningCorrection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): MoneyOpeningCorrection[] => {
    if (
      !isRecord(entry) ||
      typeof entry.at !== "string" ||
      typeof entry.source !== "string" ||
      !Number.isInteger(entry.amountMinor) ||
      !Number.isInteger(entry.previousAmountMinor) ||
      !Number.isInteger(entry.ledgerVersion)
    ) {
      return [];
    }
    return [
      {
        at: entry.at,
        amountMinor: Number(entry.amountMinor),
        previousAmountMinor: Number(entry.previousAmountMinor),
        ledgerVersion: Number(entry.ledgerVersion),
        source: entry.source as MoneyOpeningProvenance["source"],
        note: typeof entry.note === "string" ? entry.note : null,
      },
    ];
  });
}

function toOpeningProvenance(value: unknown): MoneyOpeningProvenance | null {
  if (!isRecord(value)) return null;
  if (typeof value.source !== "string" || typeof value.recordedAt !== "string") {
    return null;
  }
  return {
    source: value.source as MoneyOpeningProvenance["source"],
    recordedAt: value.recordedAt,
    cutoffDate: typeof value.cutoffDate === "string" ? value.cutoffDate : null,
    evidence: typeof value.evidence === "string" ? value.evidence : null,
    note: typeof value.note === "string" ? value.note : null,
    corrections: toCorrections(value.corrections),
  };
}

function toProvenance(value: unknown): MoneyPeriodProvenance {
  if (!isRecord(value)) {
    return { opening: null, createdFrom: "web" };
  }
  return {
    opening: toOpeningProvenance(value.opening),
    createdFrom: value.createdFrom === "mcp" ? "mcp" : "web",
  };
}

function toSettings(value: unknown): MoneyPeriodSettings {
  return isRecord(value) ? (value as MoneyPeriodSettings) : {};
}

function toPeriod(row: PeriodRow): MoneyPeriod {
  return {
    id: String(row.id),
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    currency: "MAD",
    timezone: String(row.timezone),
    activeDate: String(row.active_date),
    lifecycle: String(row.lifecycle) as MoneyPeriodLifecycle,
    initialization: String(row.initialization) as MoneyPeriodInitialization,
    openingMovementId:
      row.opening_movement_id == null ? null : String(row.opening_movement_id),
    provenance: toProvenance(row.provenance),
    settings: toSettings(row.settings),
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toOpening(row: OpeningRow): MoneyOpening {
  return {
    id: String(row.id),
    amountMinor: Number(row.amount_minor),
    currency: "MAD",
    bookingDate: String(row.booking_date),
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/* ---------------------------------------------------------------------------
 * MONEY-09 day close rows
 * ------------------------------------------------------------------------- */

type CloseRow = {
  id: string;
  period_id: string;
  close_date: string;
  status: string;
  note: string | null;
  operation_id: string;
  close_fingerprint: string;
  expected_period_version: number;
  period_version_after: number;
  active_date_after: string;
  lifecycle_after: string;
  is_final_day: boolean;
  algorithm_version: string;
  policy_version_id: string | null;
  policy_version: number | null;
  baseline_version: number;
  included_movement_ids: unknown;
  snapshot: unknown;
  created_at: string;
};

const CLOSE_COLUMNS =
  "id, period_id, close_date, status, note, operation_id, close_fingerprint, expected_period_version, period_version_after, active_date_after, lifecycle_after, is_final_day, algorithm_version, policy_version_id, policy_version, baseline_version, included_movement_ids, snapshot, created_at";

function toMinor(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function toCategoryTotals(value: unknown): Partial<Record<ExpenseCategory, number>> {
  if (!isRecord(value)) return {};
  const totals: Partial<Record<ExpenseCategory, number>> = {};
  for (const [category, amount] of Object.entries(value)) {
    const minor = toMinor(amount);
    if (minor !== null) totals[category as ExpenseCategory] = minor;
  }
  return totals;
}

function toClose(row: CloseRow): MoneyDayClose | null {
  if (!isRecord(row.snapshot)) return null;
  const snapshot = row.snapshot;
  const baseline = isRecord(snapshot.dayStartBaseline)
    ? snapshot.dayStartBaseline
    : null;
  const reference = isRecord(snapshot.dailyReference)
    ? snapshot.dailyReference
    : null;
  const reserves = isRecord(snapshot.reserves) ? snapshot.reserves : null;
  if (!baseline || !reference || !reserves) return null;

  const baselineSnapshot = {
    date: String(baseline.date),
    version: Number(baseline.version),
    availability: baseline.availability === "available" ? ("available" as const) : ("unavailable" as const),
    policyVersionId:
      typeof baseline.policyVersionId === "string" ? baseline.policyVersionId : null,
    cashMinor: toMinor(baseline.cashMinor),
    commitmentsMinor: toMinor(baseline.commitmentsMinor),
    savingsTargetMinor: toMinor(baseline.savingsTargetMinor),
    savingsFundedMinor: toMinor(baseline.savingsFundedMinor),
    emergencyTargetMinor: toMinor(baseline.emergencyTargetMinor),
    emergencyUsedMinor: toMinor(baseline.emergencyUsedMinor),
  };
  const referenceSnapshot =
    reference.available === true
      ? {
          available: true as const,
          algorithm: String(reference.algorithm),
          daysRemaining: Number(reference.daysRemaining),
          safePoolMinor: Number(reference.safePoolMinor),
          referenceMinor: Number(reference.referenceMinor),
          dailyRemainingMinor: Number(reference.dailyRemainingMinor),
        }
      : {
          available: false as const,
          reason: typeof reference.reason === "string" ? reference.reason : "baseline_unavailable",
        };
  const reserveNumbers = {
    recordedCashMinor: toMinor(reserves.recordedCashMinor),
    unpaidCommitmentsMinor: toMinor(reserves.unpaidCommitmentsMinor),
    savingsTargetMinor: toMinor(reserves.savingsTargetMinor),
    fundedSavingsMinor: toMinor(reserves.fundedSavingsMinor),
    unfundedSavingsMinor: toMinor(reserves.unfundedSavingsMinor),
    emergencyTargetMinor: toMinor(reserves.emergencyTargetMinor),
    emergencyUsedMinor: toMinor(reserves.emergencyUsedMinor),
    remainingEmergencyMinor: toMinor(reserves.remainingEmergencyMinor),
    safeFlexibleMinor: toMinor(reserves.safeFlexibleMinor),
  };
  if (Object.values(reserveNumbers).some((value) => value === null)) return null;
  const recordedCash = toMinor(snapshot.recordedCashMinor);
  if (recordedCash === null) return null;

  return {
    id: String(row.id),
    periodId: String(row.period_id),
    closeDate: String(row.close_date),
    status: "closed",
    note: row.note == null ? null : String(row.note),
    operationId: String(row.operation_id),
    closeFingerprint: String(row.close_fingerprint),
    expectedPeriodVersion: Number(row.expected_period_version),
    periodVersionAfter: Number(row.period_version_after),
    activeDateAfter: String(row.active_date_after),
    lifecycleAfter: row.lifecycle_after === "ended" ? "ended" : "tracking",
    isFinalDay: Boolean(row.is_final_day),
    algorithmVersion: String(row.algorithm_version),
    policyVersionId:
      row.policy_version_id == null ? null : String(row.policy_version_id),
    policyVersion: row.policy_version == null ? null : Number(row.policy_version),
    baselineVersion: Number(row.baseline_version),
    includedMovementIds: Array.isArray(row.included_movement_ids)
      ? row.included_movement_ids.map((id) => String(id))
      : [],
    snapshot: {
      currency: "MAD",
      expenseTotalMinor: Number(snapshot.expenseTotalMinor),
      dailyIncludedSpendMinor: Number(snapshot.dailyIncludedSpendMinor),
      flexibleExpenseTotalMinor: Number(snapshot.flexibleExpenseTotalMinor),
      fixedExpenseTotalMinor: Number(snapshot.fixedExpenseTotalMinor),
      emergencyExpenseTotalMinor: Number(snapshot.emergencyExpenseTotalMinor),
      categoryTotals: toCategoryTotals(snapshot.categoryTotals),
      recordedCashMinor: recordedCash,
      recordedCashBasis: "recorded",
      dayStartBaseline: baselineSnapshot,
      dailyReference: referenceSnapshot,
      reserves: reserveNumbers as MoneyDayClose["snapshot"]["reserves"],
    },
    createdAt: String(row.created_at),
  };
}

export class SupabaseMoneyPeriodRepository implements MoneyPeriodRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async ensureDayStartBaseline(actor: AuthenticatedActor, periodId: string, date: string) {
    // RPC authorization is bound to auth.uid() by the database function; the
    // request-scoped client carries the verified actor session.
    void actor;
    const { data, error } = await this.supabase.rpc("money_ensure_day_start_baseline", {
      p_period_id: periodId,
      p_date: date,
    });
    if (error) return { ok: false as const, error: moneyFailure(error) };
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { ok: false as const, error: { code: "unknown" as const } };
    return { ok: true as const, value: {
      date: row.date,
      version: row.version,
      availability: row.availability,
      unavailableReason: row.unavailable_reason,
      cashMinor: row.cash_minor,
      commitmentsMinor: row.commitments_minor,
      savingsTargetMinor: row.savings_target_minor,
      savingsFundedMinor: row.savings_funded_minor,
      emergencyTargetMinor: row.emergency_target_minor,
      emergencyUsedMinor: row.emergency_used_minor,
    } };
  }

  async rebaseDayStartBaseline(actor: AuthenticatedActor, periodId: string) {
    // The authenticated request client supplies auth.uid(); actor is retained
    // in the port contract and the RPC enforces ownership itself.
    void actor;
    const { data, error } = await this.supabase.rpc("money_rebase_day_start_baseline", {
      p_period_id: periodId,
    });
    if (error) return { ok: false as const, error: moneyFailure(error) };
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { ok: false as const, error: { code: "unknown" as const } };
    return { ok: true as const, value: {
      date: row.date,
      version: row.version,
      availability: row.availability,
      unavailableReason: row.unavailable_reason,
      cashMinor: row.cash_minor,
      commitmentsMinor: row.commitments_minor,
      savingsTargetMinor: row.savings_target_minor,
      savingsFundedMinor: row.savings_funded_minor,
      emergencyTargetMinor: row.emergency_target_minor,
      emergencyUsedMinor: row.emergency_used_minor,
    } };
  }

  async getDayStartBaseline(
    actor: AuthenticatedActor,
    periodId: string,
    date: string,
  ) {
    const { data, error } = await this.supabase
      .from("money_day_start_baselines")
      .select("date, version, availability, unavailable_reason, cash_minor, commitments_minor, savings_target_minor, savings_funded_minor, emergency_target_minor, emergency_used_minor")
      .eq("owner_user_id", actor.userId)
      .eq("period_id", periodId)
      .eq("date", date)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return { ok: false as const, error: moneyFailure(error) };
    if (!data) return { ok: true as const, value: null };
    return { ok: true as const, value: {
      date: data.date,
      version: data.version,
      availability: data.availability,
      unavailableReason: data.unavailable_reason,
      cashMinor: data.cash_minor,
      commitmentsMinor: data.commitments_minor,
      savingsTargetMinor: data.savings_target_minor,
      savingsFundedMinor: data.savings_funded_minor,
      emergencyTargetMinor: data.emergency_target_minor,
      emergencyUsedMinor: data.emergency_used_minor,
    } };
  }

  async getDailyIncludedExpenseTotal(actor: AuthenticatedActor, periodId: string, date: string) {
    let amountMinor = 0;
    let complete = false;
    let safe = true;
    for (let offset = 0; offset < LEDGER_PAGED_MAX_ROWS; offset += LEDGER_PAGE_SIZE) {
      const { data, error } = await this.supabase
        .from(LEDGER_TABLE)
        .select("amount_minor")
        .eq("owner_user_id", actor.userId)
        .eq("period_id", periodId)
        .eq("booking_date", date)
        .eq("kind", "expense")
        .eq("direction", "out")
        .eq("counts_in_daily", true)
        .is("deleted_at", null)
        .order("id", { ascending: true })
        .range(offset, offset + LEDGER_PAGE_SIZE - 1);
      if (error) return { ok: false as const, error: moneyFailure(error) };
      const rows = (data ?? []) as Array<{ amount_minor: number }>;
      for (const row of rows) {
        const amount = Number(row.amount_minor);
        if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(amountMinor + amount)) safe = false;
        amountMinor += amount;
      }
      if (rows.length < LEDGER_PAGE_SIZE) {
        complete = true;
        break;
      }
    }
    return { ok: true as const, value: { amountMinor, complete: complete && safe } };
  }

  async findTracking(
    actor: AuthenticatedActor,
  ): Promise<RepositoryResult<MoneyPeriod | null>> {
    const { data, error } = await this.supabase
      .from(PERIOD_TABLE)
      .select(PERIOD_COLUMNS)
      .eq("owner_user_id", actor.userId)
      .eq("lifecycle", "tracking")
      .maybeSingle();
    if (error) return { ok: false, error: moneyFailure(error) };
    return { ok: true, value: data ? toPeriod(data as PeriodRow) : null };
  }

  async findById(
    actor: AuthenticatedActor,
    id: string,
  ): Promise<RepositoryResult<MoneyPeriod | null>> {
    const { data, error } = await this.supabase
      .from(PERIOD_TABLE)
      .select(PERIOD_COLUMNS)
      .eq("owner_user_id", actor.userId)
      .eq("id", id)
      .maybeSingle();
    if (error) return { ok: false, error: moneyFailure(error) };
    return { ok: true, value: data ? toPeriod(data as PeriodRow) : null };
  }

  async findByExactRange(
    actor: AuthenticatedActor,
    range: Readonly<{ startDate: string; endDate: string }>,
  ): Promise<RepositoryResult<MoneyPeriod[]>> {
    const { data, error } = await this.supabase
      .from(PERIOD_TABLE)
      .select(PERIOD_COLUMNS)
      .eq("owner_user_id", actor.userId)
      .eq("start_date", range.startDate)
      .eq("end_date", range.endDate)
      .order("end_date", { ascending: false });
    if (error) return { ok: false, error: moneyFailure(error) };
    return {
      ok: true,
      value: ((data ?? []) as PeriodRow[]).map(toPeriod),
    };
  }

  async findOverlapping(
    actor: AuthenticatedActor,
    range: Readonly<{ startDate: string; endDate: string }>,
  ): Promise<RepositoryResult<MoneyPeriod[]>> {
    const { data, error } = await this.supabase
      .from(PERIOD_TABLE)
      .select(PERIOD_COLUMNS)
      .eq("owner_user_id", actor.userId)
      .lte("start_date", range.endDate)
      .gte("end_date", range.startDate)
      .order("start_date", { ascending: true });
    if (error) return { ok: false, error: moneyFailure(error) };
    return {
      ok: true,
      value: ((data ?? []) as PeriodRow[]).map(toPeriod),
    };
  }

  async list(
    actor: AuthenticatedActor,
    limit: number,
  ): Promise<RepositoryResult<MoneyPeriod[]>> {
    const { data, error } = await this.supabase
      .from(PERIOD_TABLE)
      .select(PERIOD_COLUMNS)
      .eq("owner_user_id", actor.userId)
      .order("end_date", { ascending: false })
      .order("start_date", { ascending: false })
      .limit(limit);
    if (error) return { ok: false, error: moneyFailure(error) };
    return {
      ok: true,
      value: ((data ?? []) as PeriodRow[]).map(toPeriod),
    };
  }

  async create(
    actor: AuthenticatedActor,
    input: MoneyPeriodCreateRecordInput,
  ): Promise<RepositoryResult<MoneyPeriod>> {
    const values = input.values;
    const { data, error } = await this.supabase.rpc("money_create_period", {
      p_start_date: values.startDate,
      p_end_date: values.endDate,
      p_timezone: values.timezone,
      p_active_date: values.activeDate,
      p_initialization:
        values.opening === null
          ? "uninitialized"
          : values.opening.source === "verified_source"
            ? "reconciled"
            : "initialized",
      p_opening_amount_minor: values.opening?.amountMinor ?? null,
      p_opening_booking_date: values.opening ? values.startDate : null,
      p_opening_create_fingerprint: input.openingCreateFingerprint,
      p_provenance: input.provenance,
      p_settings: values.settings,
      p_created_at: input.createdAt,
    });
    if (error) return { ok: false, error: moneyFailure(error) };
    const row = firstRow(data);
    if (!row) return { ok: false, error: { code: "unknown" } };
    return { ok: true, value: toPeriod(row as unknown as PeriodRow) };
  }

  async update(
    actor: AuthenticatedActor,
    id: string,
    input: MoneyPeriodUpdateRecordInput,
  ): Promise<RepositoryResult<MoneyPeriod>> {
    const opening = input.opening;
    const { data, error } = await this.supabase.rpc("money_update_period", {
      p_period_id: id,
      p_expected_version: input.expectedVersion,
      p_active_date: input.activeDate ?? null,
      p_settings: input.settings ?? null,
      p_opening_amount_minor: opening?.values.amountMinor ?? null,
      p_opening_create_fingerprint: opening?.createFingerprint ?? null,
      p_opening_note: opening?.values.note ?? null,
      p_provenance: opening?.provenance ?? null,
      p_initialization: opening?.initialization ?? null,
      p_updated_at: input.updatedAt,
    });
    if (error) return { ok: false, error: moneyFailure(error) };
    const row = firstRow(data);
    if (row) return { ok: true, value: toPeriod(row as unknown as PeriodRow) };

    // A null result means the version precondition did not match (or the
    // period belongs to another owner). Re-read to answer 404 vs 409.
    const current = await this.findById(actor, id);
    if (!current.ok) return current;
    return {
      ok: false,
      error: { code: current.value ? "conflict" : "notFound" },
    };
  }

  async closeDay(
    actor: AuthenticatedActor,
    input: MoneyDayCloseRecordInput,
  ): Promise<RepositoryResult<MoneyDayCloseAttempt>> {
    // The RPC owns the period row lock, snapshot calculation, close insert and
    // the single active-date advance. Its jsonb status vocabulary keeps the
    // refusal reason exact instead of collapsing validation into a generic
    // conflict; a transport failure is still a repository failure.
    void actor;
    const { data, error } = await this.supabase.rpc("money_close_day", {
      p_period_id: input.periodId,
      p_expected_version: input.expectedVersion,
      p_date: input.date,
      p_note: input.note,
      p_operation_id: input.operationId,
      p_close_fingerprint: input.closeFingerprint,
      p_included_movement_ids: input.includedMovementIds,
      p_created_at: input.createdAt,
    });
    if (error) return { ok: false, error: moneyFailure(error) };
    if (!isRecord(data)) return { ok: false, error: { code: "unknown" } };
    const status = String(data.status ?? "");
    const allowed = new Set([
      "closed",
      "replayed",
      "not_found",
      "stale_version",
      "period_not_tracking",
      "date_out_of_period",
      "close_date_not_active",
      "operation_conflict",
      "duplicate_close",
      "baseline_unavailable",
      "opening_unknown",
      "included_movement_invalid",
    ]);
    if (!allowed.has(status)) return { ok: false, error: { code: "unknown" } };
    const closeRow = isRecord(data.close) ? (data.close as unknown as CloseRow) : null;
    const periodRow = isRecord(data.period)
      ? (data.period as unknown as PeriodRow)
      : null;
    return {
      ok: true,
      value: {
        status: status as MoneyDayCloseAttempt["status"],
        detail: typeof data.detail === "string" ? data.detail : null,
        close: closeRow ? toClose(closeRow) : null,
        period: periodRow ? toPeriod(periodRow) : null,
      },
    };
  }

  async listDayCloses(
    actor: AuthenticatedActor,
    periodId: string,
    limit: number,
  ): Promise<RepositoryResult<MoneyDayClose[]>> {
    const { data, error } = await this.supabase
      .from("money_day_closes")
      .select(CLOSE_COLUMNS)
      .eq("owner_user_id", actor.userId)
      .eq("period_id", periodId)
      .order("close_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return { ok: false, error: moneyFailure(error) };
    const closes = ((data ?? []) as CloseRow[])
      .map(toClose)
      .filter((close): close is MoneyDayClose => close !== null);
    return { ok: true, value: closes };
  }

  async getDayCloseByOperation(
    actor: AuthenticatedActor,
    operationId: string,
  ): Promise<RepositoryResult<MoneyDayClose | null>> {
    const { data, error } = await this.supabase
      .from("money_day_closes")
      .select(CLOSE_COLUMNS)
      .eq("owner_user_id", actor.userId)
      .eq("operation_id", operationId)
      .maybeSingle();
    if (error) return { ok: false, error: moneyFailure(error) };
    return { ok: true, value: data ? toClose(data as CloseRow) : null };
  }

  async getDayCloseCurrentTotals(
    actor: AuthenticatedActor,
    periodId: string,
    date: string,
  ): Promise<RepositoryResult<MoneyDayCloseCurrentTotals>> {
    let expenseTotalMinor = 0;
    let dailyIncludedSpendMinor = 0;
    let flexibleExpenseTotalMinor = 0;
    let fixedExpenseTotalMinor = 0;
    let emergencyExpenseTotalMinor = 0;
    const categoryTotals: Partial<Record<ExpenseCategory, number>> = {};
    let complete = false;

    for (let offset = 0; offset < LEDGER_PAGED_MAX_ROWS; offset += LEDGER_PAGE_SIZE) {
      const { data, error } = await this.supabase
        .from(LEDGER_TABLE)
        .select("amount_minor, counts_in_daily, purpose, category")
        .eq("owner_user_id", actor.userId)
        .eq("period_id", periodId)
        .eq("booking_date", date)
        .eq("kind", "expense")
        .eq("direction", "out")
        .is("deleted_at", null)
        .order("id", { ascending: true })
        .range(offset, offset + LEDGER_PAGE_SIZE - 1);
      if (error) return { ok: false, error: moneyFailure(error) };
      const rows = (data ?? []) as Array<{
        amount_minor: number;
        counts_in_daily: boolean;
        purpose: string | null;
        category: string | null;
      }>;
      for (const row of rows) {
        const amount = Number(row.amount_minor);
        expenseTotalMinor += amount;
        if (row.counts_in_daily) dailyIncludedSpendMinor += amount;
        if (row.purpose === "flexible") flexibleExpenseTotalMinor += amount;
        if (row.purpose === "fixed") fixedExpenseTotalMinor += amount;
        if (row.purpose === "emergency") emergencyExpenseTotalMinor += amount;
        if (row.category) {
          const category = row.category as ExpenseCategory;
          categoryTotals[category] = (categoryTotals[category] ?? 0) + amount;
        }
      }
      if (rows.length < LEDGER_PAGE_SIZE) {
        complete = true;
        break;
      }
    }

    return {
      ok: true,
      value: {
        complete,
        expenseTotalMinor,
        dailyIncludedSpendMinor,
        flexibleExpenseTotalMinor,
        fixedExpenseTotalMinor,
        emergencyExpenseTotalMinor,
        categoryTotals,
      },
    };
  }

  async getOpening(
    actor: AuthenticatedActor,
    id: string,
  ): Promise<RepositoryResult<MoneyOpening | null>> {
    const { data, error } = await this.supabase
      .from(LEDGER_TABLE)
      .select(OPENING_COLUMNS)
      .eq("owner_user_id", actor.userId)
      .eq("id", id)
      .eq("kind", "opening")
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return { ok: false, error: moneyFailure(error) };
    return { ok: true, value: data ? toOpening(data as OpeningRow) : null };
  }

  async sumLedgerByDirection(
    actor: AuthenticatedActor,
    window: MoneyLedgerWindow,
  ): Promise<RepositoryResult<MoneyLedgerDirectionTotals>> {
    const PAGE_SIZE = 1000;
    const MAX_ROWS = 10_000;
    let inflowsMinor = 0;
    let outflowsMinor = 0;
    let recordCount = 0;
    let truncated = false;

    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await this.supabase
        .from(LEDGER_TABLE)
        .select("direction, amount_minor")
        .eq("owner_user_id", actor.userId)
        .is("deleted_at", null)
        .neq("kind", "opening")
        .gte("booking_date", window.startDate)
        .lte("booking_date", window.endDateInclusive)
        .order("booking_date", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) return { ok: false, error: moneyFailure(error) };
      const rows = (data ?? []) as Array<{
        direction: string;
        amount_minor: number;
      }>;
      for (const row of rows) {
        if (row.direction === "in") {
          inflowsMinor += Number(row.amount_minor);
        } else if (row.direction === "out") {
          outflowsMinor += Number(row.amount_minor);
        }
        recordCount += 1;
      }
      if (rows.length < PAGE_SIZE) break;
      if (recordCount >= MAX_ROWS) {
        truncated = true;
        break;
      }
    }

    return {
      ok: true,
      value: { inflowsMinor, outflowsMinor, recordCount, truncated },
    };
  }

  async ledgerOverview(
    actor: AuthenticatedActor,
    range: Readonly<{
      periodId: string | null;
      startDate: string;
      endDate: string;
    }>,
  ): Promise<RepositoryResult<MoneyLedgerOverview>> {
    const base = () =>
      this.supabase
        .from(LEDGER_TABLE)
        .select("id", { count: "exact", head: true })
        .eq("owner_user_id", actor.userId)
        .eq("kind", "expense")
        .is("deleted_at", null);

    const total = await base();
    if (total.error) return { ok: false, error: moneyFailure(total.error) };

    let assignedToPeriodCount = 0;
    if (range.periodId !== null) {
      const assigned = await base().eq("period_id", range.periodId);
      if (assigned.error) return { ok: false, error: moneyFailure(assigned.error) };
      assignedToPeriodCount = assigned.count ?? 0;
    }

    const unassigned =
      range.periodId === null
        ? { count: 0, error: null }
        : await base()
            .is("period_id", null)
            .gte("booking_date", range.startDate)
            .lte("booking_date", range.endDate);
    if (unassigned.error) {
      return { ok: false, error: moneyFailure(unassigned.error) };
    }

    return {
      ok: true,
      value: {
        totalExpenseCount: total.count ?? 0,
        assignedToPeriodCount,
        inPeriodUnassignedCount: unassigned.count ?? 0,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Movement rows (MONEY-04)
// ---------------------------------------------------------------------------

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

export class SupabaseMoneyRepository implements MoneyMovementRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async findByIdempotencyKey(
    actor: AuthenticatedActor,
    idempotencyKey: string,
  ): Promise<RepositoryResult<MoneyIdempotencyReceipt | null>> {
    const { data, error } = await this.supabase
      .from(LEDGER_TABLE)
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
      .from(LEDGER_TABLE)
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
      .from(LEDGER_TABLE)
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
      .from(LEDGER_TABLE)
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
      .from(LEDGER_TABLE)
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
      .from(LEDGER_TABLE)
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
   * application turns into an incomplete reading rather than a fake total.
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
      purpose: MoneyPurpose | null;
      booking_date: string;
    }> = [];
    let truncated = false;

    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
      let request = this.supabase
        .from(LEDGER_TABLE)
        .select("id, kind, direction, amount_minor, counts_in_daily, purpose, booking_date")
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
            purpose: row.purpose,
            bookingDate: String(row.booking_date),
          };
        }),
        truncated,
      },
    };
  }
}
