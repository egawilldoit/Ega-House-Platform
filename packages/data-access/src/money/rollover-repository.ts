import type {
  AuthenticatedActor,
  MoneyRolloverBridgeList,
  MoneyRolloverBridgeRecord,
  MoneyRolloverPendingOccurrence,
  MoneyRolloverRecord,
  MoneyRolloverRepository,
  MoneyRolloverSourceContext,
  MoneyRolloverWriteInput,
  MoneyRolloverWriteResult,
  RepositoryResult,
} from "@ega/application";
import {
  parseMoneySettings,
  type MoneyPeriod,
} from "@ega/domain/money";
import type {
  MoneyRolloverCloseSnapshotAssessment,
  MoneyRolloverCloseSnapshotDifference,
} from "@ega/domain/money-rollover";
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
const BRIDGE_TABLE = "money_period_rollover_bridges";
const POLICY_TABLE = "money_policy_versions";
const OBLIGATION_TABLE = "money_obligations";
const PERIOD_TABLE = "money_periods";

const ROLLOVER_COLUMNS =
  "id, source_period_id, successor_period_id, operation_id, request_fingerprint, opening_mode, opening_amount_minor, closing_cash_minor, closing_cutoff_date, unpaid_treatment, reconciliation_accepted_note, generated_occurrence_count, carried_occurrence_count, cancelled_occurrence_count, created_at";

const BRIDGE_COLUMNS =
  "id, source_period_id, destination_period_id, movement_id, correction_version, amount_minor, direction, booking_date, applied, variance_reason, created_at";

const PENDING_PAGE_SIZE = 1000;
const PENDING_MAX_ROWS = 10000;
const BRIDGE_READ_LIMIT = 500;

type PolicyRow = { policy: unknown };

type PendingRow = {
  id: string;
  kind: string;
  description: string;
  amount_minor: number;
  due_date: string;
  template_id: string | null;
  need_vs_want: string | null;
  purpose: string | null;
  counts_in_daily: boolean | null;
  category: string | null;
};

type BridgeRow = {
  id: string;
  source_period_id: string;
  destination_period_id: string;
  movement_id: string;
  correction_version: number;
  amount_minor: number;
  direction: "in" | "out";
  booking_date: string;
  applied: boolean;
  variance_reason:
    | "verified_opening_covered_cutoff"
    | "verified_opening_excludes_correction"
    | null;
  created_at: string;
};

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

function toCloseSnapshotAssessment(
  value: unknown,
): MoneyRolloverCloseSnapshotAssessment {
  if (!value || typeof value !== "object") {
    return { available: false, reason: "close_snapshot_summary_invalid" };
  }
  const row = value as Record<string, unknown>;
  if (row.available !== true) {
    return {
      available: false,
      reason:
        typeof row.reason === "string" && row.reason.trim()
          ? row.reason
          : "close_snapshot_summary_unavailable",
    };
  }
  const missingCloseDates = row.missingCloseDates;
  if (
    typeof row.closeCount !== "number" ||
    !Number.isInteger(row.closeCount) ||
    row.closeCount < 0 ||
    typeof row.requiredCloseCount !== "number" ||
    !Number.isInteger(row.requiredCloseCount) ||
    row.requiredCloseCount < 1 ||
    (row.trackedFromDate !== null && typeof row.trackedFromDate !== "string") ||
    !Array.isArray(missingCloseDates) ||
    !missingCloseDates.every(
      (date) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date),
    ) ||
    new Set(missingCloseDates).size !== missingCloseDates.length ||
    typeof row.completeCloseEvidence !== "boolean" ||
    row.completeCloseEvidence !==
      (missingCloseDates.length === 0 &&
        row.closeCount === row.requiredCloseCount) ||
    // Every close is inside [first close, end], so the tracked days without a
    // close must exactly account for the required-minus-retained difference.
    row.requiredCloseCount - missingCloseDates.length !== row.closeCount ||
    row.comparableToRestatedTotals !== true ||
    typeof row.restatedDifferenceCount !== "number" ||
    !Number.isInteger(row.restatedDifferenceCount) ||
    row.restatedDifferenceCount < 0 ||
    !Array.isArray(row.restatedDifferences) ||
    typeof row.paidObligationCount !== "number" ||
    typeof row.paidObligationMismatchCount !== "number" ||
    typeof row.countedVisitCount !== "number" ||
    typeof row.countedVisitMismatchCount !== "number" ||
    typeof row.savingsTransferredMinor !== "number" ||
    (row.savingsTargetMinor !== null &&
      typeof row.savingsTargetMinor !== "number")
  ) {
    return { available: false, reason: "close_snapshot_summary_invalid" };
  }
  const differences: MoneyRolloverCloseSnapshotDifference[] = [];
  for (const entry of row.restatedDifferences) {
    if (!entry || typeof entry !== "object") {
      return { available: false, reason: "close_snapshot_summary_invalid" };
    }
    const item = entry as Record<string, unknown>;
    if (
      typeof item.closeId !== "string" ||
      typeof item.closeDate !== "string" ||
      !Array.isArray(item.changedFields) ||
      !item.changedFields.every((field) => typeof field === "string")
    ) {
      return { available: false, reason: "close_snapshot_summary_invalid" };
    }
    differences.push({
      closeId: item.closeId,
      closeDate: item.closeDate,
      changedFields: item.changedFields.map(String),
    });
  }
  if (differences.length !== row.restatedDifferenceCount) {
    return { available: false, reason: "close_snapshot_summary_incomplete" };
  }
  return {
    available: true,
    closeCount: row.closeCount,
    requiredCloseCount: row.requiredCloseCount,
    trackedFromDate:
      typeof row.trackedFromDate === "string" ? row.trackedFromDate : null,
    missingCloseDates: missingCloseDates.map(String),
    completeCloseEvidence: row.completeCloseEvidence,
    lastClosedDate:
      typeof row.lastClosedDate === "string" ? row.lastClosedDate : null,
    comparableToRestatedTotals: true,
    restatedDifferenceCount: row.restatedDifferenceCount,
    restatedDifferences: differences,
    paidObligationCount: row.paidObligationCount,
    paidObligationMismatchCount: row.paidObligationMismatchCount,
    countedVisitCount: row.countedVisitCount,
    countedVisitMismatchCount: row.countedVisitMismatchCount,
    savingsTargetMinor: row.savingsTargetMinor,
    savingsTransferredMinor: row.savingsTransferredMinor,
  };
}

type SupabaseError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
} | null;

function failure(error: SupabaseError) {
  if (error?.code === "42501") return { code: "forbidden" as const };
  if (error?.code === "P0002") return { code: "notFound" as const };
  if (
    error?.code === "23505" ||
    error?.code === "23503" ||
    error?.code === "23514" ||
    error?.code === "23P01" ||
    // The atomic rollover re-derives the closing balance and uses 40001 for a
    // stale preview/version; treat it as a retryable conflict, not unknown.
    error?.code === "40001"
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

function toBridgeRecord(row: BridgeRow): MoneyRolloverBridgeRecord {
  return {
    id: String(row.id),
    sourcePeriodId: String(row.source_period_id),
    destinationPeriodId: String(row.destination_period_id),
    movementId: String(row.movement_id),
    correctionVersion: Number(row.correction_version),
    amountMinor: Number(row.amount_minor),
    direction: row.direction === "in" ? "in" : "out",
    bookingDate: String(row.booking_date),
    applied: row.applied === true,
    varianceReason: row.variance_reason,
    createdAt: String(row.created_at),
  };
}

function toPendingOccurrence(row: PendingRow): MoneyRolloverPendingOccurrence {
  return {
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
  };
}

export class SupabaseMoneyRolloverRepository implements MoneyRolloverRepository {
  private readonly periods: SupabaseMoneyPeriodRepository;

  constructor(private readonly supabase: SupabaseClient) {
    this.periods = new SupabaseMoneyPeriodRepository(supabase);
  }

  private async pendingOccurrences(
    actor: AuthenticatedActor,
    period: MoneyPeriod,
  ): Promise<
    RepositoryResult<{
      rows: readonly MoneyRolloverPendingOccurrence[];
      truncated: boolean;
    }>
  > {
    const rows: PendingRow[] = [];
    let expected: number | null = null;
    let offset = 0;
    let complete = false;
    while (offset < PENDING_MAX_ROWS) {
      const { data, error, count } = await this.supabase
        .from(OBLIGATION_TABLE)
        .select(
          "id, kind, description, amount_minor, due_date, template_id, need_vs_want, purpose, counts_in_daily, category",
          { count: "exact" },
        )
        .eq("owner_user_id", actor.userId)
        .eq("state", "pending")
        .lte("period_start", period.endDate)
        .gte("period_end", period.startDate)
        .order("due_date", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + PENDING_PAGE_SIZE - 1);
      if (error) return { ok: false, error: failure(error) };
      const page = (data ?? []) as PendingRow[];
      if (expected === null && typeof count === "number") expected = count;
      rows.push(...page);
      // A matching count above the hard bound cannot be represented completely;
      // the caller must block rather than undercount reconciliation inputs.
      if (expected !== null && expected > PENDING_MAX_ROWS) break;
      offset += page.length;
      if (expected !== null) {
        if (rows.length >= expected) {
          complete = rows.length === expected;
          break;
        }
        if (page.length === 0) break;
      } else {
        break;
      }
    }
    return {
      ok: true,
      value: {
        rows: rows.map(toPendingOccurrence),
        truncated: !complete,
      },
    };
  }

  async listCorrectionBridges(
    actor: AuthenticatedActor,
    destinationPeriodId: string,
  ): Promise<RepositoryResult<MoneyRolloverBridgeList>> {
    const period = await this.periods.findById(actor, destinationPeriodId);
    if (!period.ok) return period;
    if (!period.value) return { ok: false, error: { code: "notFound" } };
    return this.readCorrectionBridges(actor, destinationPeriodId);
  }

  private async readCorrectionBridges(
    actor: AuthenticatedActor,
    destinationPeriodId: string,
  ): Promise<RepositoryResult<MoneyRolloverBridgeList>> {
    const { data, error, count } = await this.supabase
      .from(BRIDGE_TABLE)
      .select(BRIDGE_COLUMNS, { count: "exact" })
      .eq("owner_user_id", actor.userId)
      .eq("destination_period_id", destinationPeriodId)
      .order("created_at", { ascending: false })
      .limit(BRIDGE_READ_LIMIT);
    if (error) return { ok: false, error: failure(error) };
    const bridges = ((data ?? []) as BridgeRow[]).map(toBridgeRecord);
    // The read is bounded. When the exact total is unavailable we cannot prove
    // the list is complete, so the caller must disclose that rather than render
    // a silently shortened variance history.
    return {
      ok: true,
      value: {
        bridges,
        truncated:
          typeof count !== "number" || count > bridges.length,
      },
    };
  }

  async getSourceContext(
    actor: AuthenticatedActor,
    sourcePeriodId: string,
  ): Promise<RepositoryResult<MoneyRolloverSourceContext | null>> {
    const periodResult = await this.periods.findById(actor, sourcePeriodId);
    if (!periodResult.ok) return periodResult;
    const period = periodResult.value;
    if (!period) return { ok: true, value: null };

    const [
      openingResult,
      totalsResult,
      pendingResult,
      successorResult,
      rolloverResult,
      closeSnapshotResult,
      policyResult,
      bridgesResult,
    ] = await Promise.all([
        period.openingMovementId
          ? this.periods.getOpening(actor, period.openingMovementId)
          : Promise.resolve({ ok: true as const, value: null }),
        this.periods.sumLedgerByDirection(actor, {
          startDate: period.startDate,
          endDateInclusive: period.endDate,
        }),
        this.pendingOccurrences(actor, period),
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
        this.supabase.rpc("money_rollover_close_snapshot_summary", {
          p_period_id: period.id,
        }),
        this.supabase
          .from(POLICY_TABLE)
          .select("policy")
          .eq("owner_user_id", actor.userId)
          .eq("period_id", period.id)
          .order("effective_date", { ascending: false })
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle(),
        this.readCorrectionBridges(actor, period.id),
      ]);

    if (!openingResult.ok) return openingResult;
    if (!totalsResult.ok) return totalsResult;
    if (!pendingResult.ok) return pendingResult;
    if (successorResult.error) {
      return { ok: false, error: failure(successorResult.error) };
    }
    if (rolloverResult.error) {
      return { ok: false, error: failure(rolloverResult.error) };
    }
    if (closeSnapshotResult.error) {
      return { ok: false, error: failure(closeSnapshotResult.error) };
    }
    if (policyResult.error) {
      return { ok: false, error: failure(policyResult.error) };
    }
    if (!bridgesResult.ok) return bridgesResult;

    const policyRow = policyResult.data as PolicyRow | null;
    const policySettings =
      policyRow?.policy && typeof policyRow.policy === "object"
        ? (policyRow.policy as Record<string, unknown>).settings
        : undefined;
    const parsedPolicy = parseMoneySettings(
      policySettings === undefined ? period.settings : policySettings,
    );
    if (!parsedPolicy.ok) {
      return { ok: false, error: { code: "unknown" } };
    }
    const effectiveSettings = parsedPolicy.value;

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
        effectiveSettings,
        modeledClosingCashMinor,
        cashComplete: !totals.truncated,
        pendingOccurrences: pendingResult.value.rows,
        pendingOccurrencesTruncated: pendingResult.value.truncated,
        closeSnapshots: toCloseSnapshotAssessment(closeSnapshotResult.data),
        priorCorrectionBridges: bridgesResult.value.bridges,
        priorCorrectionBridgesTruncated: bridgesResult.value.truncated,
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
      p_settings: input.settingsOverrides,
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
