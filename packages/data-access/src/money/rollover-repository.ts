import type {
  AuthenticatedActor,
  MoneyRolloverBridgeRepository,
  MoneyRolloverBridgeWriteInput,
  MoneyRolloverBridgeWriteResult,
  MoneyRolloverRecord,
  MoneyRolloverRepository,
  MoneyRolloverSourceContext,
  MoneyRolloverWriteInput,
  MoneyRolloverWriteResult,
  RepositoryResult,
} from "@ega/application";
import type { MoneyPeriod } from "@ega/domain/money";
import type { ExpenseCategory } from "@ega/domain/expenses";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeSupabaseError } from "../supabase/errors";
import { SupabaseMoneyPeriodRepository } from "./repository";

/**
 * Request-scoped Supabase adapter for explicit period rollover (MONEY-10).
 *
 * Reads stay on the canonical MONEY-03 period repository. The write is one
 * database function call so the successor period, its single opening movement,
 * generated occurrences and the source lifecycle link commit or roll back
 * together. RLS and `auth.uid()` remain authoritative inside the function; the
 * adapter never selects an owner from the request.
 */

const ROLLOVER_TABLE = "money_period_rollovers";
const OBLIGATION_TABLE = "money_obligations";
const PERIOD_TABLE = "money_periods";

const ROLLOVER_COLUMNS =
  "id, source_period_id, successor_period_id, operation_id, request_fingerprint, opening_mode, opening_amount_minor, closing_cash_minor, closing_cutoff_date, unpaid_treatment, reconciliation_accepted_note, generated_occurrence_count, carried_occurrence_count, cancelled_occurrence_count, created_at";

type RolloverRow = {
  id: string;
  source_period_id: string;
  successor_period_id: string;
  operation_id: string;
  request_fingerprint: string;
  opening_mode: "carry_forward" | "verified_source";
  opening_amount_minor: number;
  closing_cash_minor: number | null;
  closing_cutoff_date: string;
  unpaid_treatment: "keep_pending" | "carry_forward" | "cancel" | null;
  reconciliation_accepted_note: string | null;
  generated_occurrence_count: number;
  carried_occurrence_count: number;
  cancelled_occurrence_count: number;
  created_at: string;
};

type SupabaseError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
} | null;

function failure(error: SupabaseError) {
  if (error?.code === "42501") return { code: "forbidden" as const };
  if (
    error?.code === "23505" ||
    error?.code === "23503" ||
    error?.code === "23514" ||
    error?.code === "23P01"
  ) {
    return { code: "conflict" as const };
  }
  return sanitizeSupabaseError(error, { conflictCode: "__none__" });
}

function toRecord(row: RolloverRow, successor: MoneyPeriod | null): MoneyRolloverRecord {
  return {
    id: String(row.id),
    sourcePeriodId: String(row.source_period_id),
    successorPeriodId: String(row.successor_period_id),
    successorPeriod: successor,
    operationId: String(row.operation_id),
    requestFingerprint: String(row.request_fingerprint),
    openingMode: row.opening_mode,
    openingAmountMinor: Number(row.opening_amount_minor),
    closingCashMinor:
      row.closing_cash_minor === null ? null : Number(row.closing_cash_minor),
    closingCutoffDate: String(row.closing_cutoff_date),
    unpaidTreatment: row.unpaid_treatment,
    reconciliationAcceptedNote: row.reconciliation_accepted_note,
    generatedOccurrenceCount: Number(row.generated_occurrence_count),
    carriedOccurrenceCount: Number(row.carried_occurrence_count),
    cancelledOccurrenceCount: Number(row.cancelled_occurrence_count),
    createdAt: String(row.created_at),
  };
}

export class SupabaseMoneyRolloverRepository implements MoneyRolloverRepository {
  private readonly periods: SupabaseMoneyPeriodRepository;

  constructor(private readonly supabase: SupabaseClient) {
    this.periods = new SupabaseMoneyPeriodRepository(supabase);
  }

  async getSourceContext(
    actor: AuthenticatedActor,
    sourcePeriodId: string,
  ): Promise<RepositoryResult<MoneyRolloverSourceContext | null>> {
    const periodResult = await this.periods.findById(actor, sourcePeriodId);
    if (!periodResult.ok) return periodResult;
    const period = periodResult.value;
    if (!period) return { ok: true, value: null };

    const [openingResult, totalsResult, pendingResult, successorResult, rolloverResult] =
      await Promise.all([
        period.openingMovementId
          ? this.periods.getOpening(actor, period.openingMovementId)
          : Promise.resolve({ ok: true as const, value: null }),
        this.periods.sumLedgerByDirection(actor, {
          startDate: period.startDate,
          endDateInclusive: period.endDate,
        }),
        this.supabase
          .from(OBLIGATION_TABLE)
          .select(
            "id, kind, description, amount_minor, due_date, template_id, need_vs_want, purpose, counts_in_daily, category",
          )
          .eq("owner_user_id", actor.userId)
          .eq("state", "pending")
          .lte("period_start", period.endDate)
          .gte("period_end", period.startDate)
          .order("due_date", { ascending: true })
          .limit(500),
        this.supabase
          .from(PERIOD_TABLE)
          .select("successor_period_id")
          .eq("owner_user_id", actor.userId)
          .eq("id", period.id)
          .maybeSingle(),
        this.supabase
          .from(ROLLOVER_TABLE)
          .select(ROLLOVER_COLUMNS)
          .eq("owner_user_id", actor.userId)
          .eq("source_period_id", period.id)
          .maybeSingle(),
      ]);

    if (!openingResult.ok) return openingResult;
    if (!totalsResult.ok) return totalsResult;
    if (pendingResult.error) {
      return { ok: false, error: failure(pendingResult.error) };
    }
    if (successorResult.error) {
      return { ok: false, error: failure(successorResult.error) };
    }
    if (rolloverResult.error) {
      return { ok: false, error: failure(rolloverResult.error) };
    }

    const opening = openingResult.value;
    const totals = totalsResult.value;
    const modeledClosingCashMinor =
      opening === null || totals.truncated
        ? null
        : opening.amountMinor + totals.inflowsMinor - totals.outflowsMinor;

    let existingRollover: MoneyRolloverRecord | null = null;
    if (rolloverResult.data) {
      const row = rolloverResult.data as RolloverRow;
      const successorPeriodResult = await this.periods.findById(
        actor,
        row.successor_period_id,
      );
      if (!successorPeriodResult.ok) return successorPeriodResult;
      existingRollover = toRecord(row, successorPeriodResult.value);
    }

    return {
      ok: true,
      value: {
        period,
        modeledClosingCashMinor,
        cashComplete: !totals.truncated,
        pendingOccurrences: (pendingResult.data ?? []).map((row) => ({
          id: String(row.id),
          kind: row.kind === "subscription" ? "subscription" : "bill",
          description: String(row.description),
          amountMinor: Number(row.amount_minor),
          dueDate: String(row.due_date),
          templateId: row.template_id == null ? null : String(row.template_id),
          needVsWant:
            row.need_vs_want === "need" || row.need_vs_want === "want"
              ? row.need_vs_want
              : null,
          purpose:
            row.purpose === "flexible" || row.purpose === "emergency"
              ? row.purpose
              : "fixed",
          countsInDaily: row.counts_in_daily === true,
          category: (row.category ?? null) as ExpenseCategory | null,
        })),
        closeSnapshots: {
          available: false,
          reason:
            "Stored day-close evidence is not available in this build, so close-to-restated comparisons cannot run. Carry-forward cash remains labeled as modeled.",
        },
        existingSuccessorPeriodId:
          successorResult.data?.successor_period_id == null
            ? null
            : String(successorResult.data.successor_period_id),
        existingRollover,
      },
    };
  }

  async findRolloverByOperation(
    actor: AuthenticatedActor,
    operationId: string,
  ): Promise<RepositoryResult<MoneyRolloverRecord | null>> {
    const { data, error } = await this.supabase
      .from(ROLLOVER_TABLE)
      .select(ROLLOVER_COLUMNS)
      .eq("owner_user_id", actor.userId)
      .eq("operation_id", operationId)
      .maybeSingle();
    if (error) return { ok: false, error: failure(error) };
    if (!data) return { ok: true, value: null };
    const row = data as RolloverRow;
    const successorResult = await this.periods.findById(actor, row.successor_period_id);
    if (!successorResult.ok) return successorResult;
    return { ok: true, value: toRecord(row, successorResult.value) };
  }

  async rollover(
    actor: AuthenticatedActor,
    input: MoneyRolloverWriteInput,
  ): Promise<RepositoryResult<MoneyRolloverWriteResult>> {
    void actor;
    const { data, error } = await this.supabase.rpc("money_rollover_period", {
      p_source_period_id: input.values.sourcePeriodId,
      p_expected_version: input.values.expectedVersion,
      p_start_date: input.targets.startDate,
      p_end_date: input.targets.endDate,
      p_active_date: input.targets.activeDate,
      p_timezone: input.targets.timezone,
      p_initialized: input.initialized,
      p_allow_uncovered_days: input.values.allowUncoveredDays,
      p_opening_amount_minor: input.opening.amountMinor,
      p_opening_cutoff_date: input.opening.cutoffDate,
      p_opening_evidence: input.opening.evidence,
      p_opening_note: input.opening.note,
      p_opening_create_fingerprint: input.openingCreateFingerprint,
      p_provenance: input.provenance,
      p_settings: input.settings,
      p_operation_id: input.operationId,
      p_request_fingerprint: input.requestFingerprint,
      p_opening_mode: input.values.opening.mode,
      p_unpaid_treatment: input.values.unpaidItems?.treatment ?? null,
      p_unpaid_reason: input.values.unpaidItems?.reason ?? null,
      p_reconciliation_accepted_note: input.reconciliationAcceptedNote,
      p_reconciliation: input.reconciliation,
      p_occurrences: input.obligations.map((item) => ({
        values: item.values,
        createFingerprint: item.createFingerprint,
      })),
      p_carried_occurrences: input.carriedOccurrences,
      p_created_at: input.createdAt,
    });
    if (error) return { ok: false, error: failure(error) };

    const payload = data as
      | { rollover?: RolloverRow; replayed?: boolean }
      | null
      | undefined;
    const row = payload?.rollover;
    if (!row) return { ok: false, error: { code: "unknown" } };

    const successorResult = await this.periods.findById(
      actor,
      String(row.successor_period_id),
    );
    if (!successorResult.ok) return successorResult;
    const record = toRecord(row, successorResult.value);
    return {
      ok: true,
      value: {
        record,
        replayed: payload?.replayed === true,
      },
    };
  }
}

export class SupabaseMoneyRolloverBridgeRepository
  implements MoneyRolloverBridgeRepository
{
  constructor(private readonly supabase: SupabaseClient) {}

  async applyBridge(
    actor: AuthenticatedActor,
    input: MoneyRolloverBridgeWriteInput,
  ): Promise<RepositoryResult<MoneyRolloverBridgeWriteResult>> {
    void actor;
    const { data, error } = await this.supabase.rpc("money_apply_rollover_bridge", {
      p_movement_id: input.movementId,
      p_previous_cash_delta_minor: input.previousCashDeltaMinor,
      p_new_cash_delta_minor: input.newCashDeltaMinor,
      p_correction_version: input.correctionVersion,
      p_correction_date: input.correctionDate,
      p_created_at: input.createdAt,
    });
    if (error) return { ok: false, error: failure(error) };
    const payload = data as
      | {
          postings?: number;
          variances?: number;
          replayed?: number;
          destination_period_ids?: unknown;
        }
      | null
      | undefined;
    if (!payload || typeof payload !== "object") {
      return { ok: false, error: { code: "unknown" } };
    }
    return {
      ok: true,
      value: {
        postings: Number(payload.postings ?? 0),
        variances: Number(payload.variances ?? 0),
        replayed: Number(payload.replayed ?? 0),
        destinationPeriodIds: Array.isArray(payload.destination_period_ids)
          ? payload.destination_period_ids.map(String)
          : [],
      },
    };
  }
}
