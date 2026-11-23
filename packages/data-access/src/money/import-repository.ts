import type {
  AuthenticatedActor,
  MoneyImportAdoptionRecord,
  MoneyImportAdoptionWrite,
  MoneyImportRange,
  MoneyImportRepository,
  MoneyImportTargetCoffeeVisit,
  MoneyImportTargetMovement,
  MoneyImportTargetObligation,
  RepositoryFailure,
  RepositoryResult,
} from "@ega/application";
import {
  MONEY_IMPORT_ADOPTION_STATUSES,
  type MoneyImportAdoptionStatus,
  type MoneyImportApproval,
  type MoneyImportManifest,
  type MoneyImportSourceSnapshot,
} from "@ega/domain/money-import";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeSupabaseError } from "../supabase/errors";

/**
 * Request-scoped Supabase adapter for MONEY-001-B adoption evidence.
 *
 * `money_import_adoptions` stores one immutable source snapshot/approved
 * manifest pair per owner+snapshot plus mutable execution evidence. It is not a
 * ledger. Every read filters the verified actor's owner id in addition to RLS,
 * paged target reads stop only when a short page proves exhaustion, and no
 * DELETE path exists.
 */

const ADOPTIONS = "money_import_adoptions";
const LEDGER = "personal_expenses";
const OBLIGATIONS = "money_obligations";
const COFFEE_VISITS = "money_coffee_visits";

const ADOPTION_COLUMNS =
  "id, owner_user_id, snapshot_id, snapshot_digest, manifest_digest, source_identity, target_environment, opening_strategy, cutover_date, status, snapshot, manifest, approval, applied_counts, post_reconciliation, created_at, updated_at, applied_at";

const TARGET_MOVEMENT_COLUMNS =
  "id, idempotency_key, kind, direction, amount_minor, category, note, merchant, booking_date, deleted_at";

const TARGET_OBLIGATION_COLUMNS =
  "id, description, amount_minor, due_date, period_start, period_end, state, payment_expense_id";

const TARGET_COFFEE_COLUMNS =
  "id, visit_key, local_date, lines:money_coffee_visit_lines(expense_id)";

const PAGE_SIZE = 500;
const MAX_TARGET_ROWS = 50_000;
const KEY_CHUNK_SIZE = 100;

type ImportSupabaseError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
} | null;

function importFailure(error: ImportSupabaseError): RepositoryFailure {
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

type AdoptionRow = {
  id: string;
  owner_user_id: string;
  snapshot_id: string;
  snapshot_digest: string;
  manifest_digest: string;
  source_identity: string;
  target_environment: string;
  opening_strategy: string;
  cutover_date: string;
  status: string;
  snapshot: unknown;
  manifest: unknown;
  approval: unknown;
  applied_counts: unknown;
  post_reconciliation: unknown;
  created_at: string;
  updated_at: string;
  applied_at: string | null;
};

function isStatus(value: string): value is MoneyImportAdoptionStatus {
  return (MONEY_IMPORT_ADOPTION_STATUSES as readonly string[]).includes(value);
}

function toAdoptionRecord(row: AdoptionRow): MoneyImportAdoptionRecord | null {
  const status = String(row.status);
  if (
    !isRecord(row.snapshot) ||
    !isRecord(row.manifest) ||
    !isRecord(row.approval) ||
    !isStatus(status)
  ) {
    return null;
  }
  return {
    id: String(row.id),
    snapshotId: String(row.snapshot_id),
    snapshotDigest: String(row.snapshot_digest),
    manifestDigest: String(row.manifest_digest),
    sourceIdentity: String(row.source_identity),
    targetEnvironment: String(row.target_environment),
    openingStrategy: row.opening_strategy === "full_history"
      ? "full_history"
      : "verified_cutover_opening",
    cutoverDate: String(row.cutover_date),
    status,
    snapshot: row.snapshot as unknown as MoneyImportSourceSnapshot,
    manifest: row.manifest as unknown as MoneyImportManifest,
    approval: row.approval as unknown as MoneyImportApproval,
    appliedCounts: isRecord(row.applied_counts)
      ? (row.applied_counts as unknown as MoneyImportAdoptionRecord["appliedCounts"])
      : null,
    postReconciliation: isRecord(row.post_reconciliation)
      ? (row.post_reconciliation as unknown as MoneyImportAdoptionRecord["postReconciliation"])
      : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    appliedAt: row.applied_at == null ? null : String(row.applied_at),
  };
}

type MovementRow = {
  id: string;
  idempotency_key: string;
  kind: string;
  direction: string;
  amount_minor: number;
  category: string | null;
  note: string | null;
  merchant: string | null;
  booking_date: string;
  deleted_at: string | null;
};

function toTargetMovement(row: MovementRow): MoneyImportTargetMovement {
  return {
    id: String(row.id),
    idempotencyKey: String(row.idempotency_key),
    kind: String(row.kind) as MoneyImportTargetMovement["kind"],
    direction: String(row.direction) as MoneyImportTargetMovement["direction"],
    amountMinor: Number(row.amount_minor),
    category:
      row.category == null
        ? null
        : (String(row.category) as MoneyImportTargetMovement["category"]),
    note: row.note == null ? null : String(row.note),
    merchant: row.merchant == null ? null : String(row.merchant),
    bookingDate: String(row.booking_date),
    deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
  };
}

type ObligationRow = {
  id: string;
  description: string;
  amount_minor: number;
  due_date: string;
  period_start: string;
  period_end: string;
  state: string;
  payment_expense_id: string | null;
};

function toTargetObligation(row: ObligationRow): MoneyImportTargetObligation {
  return {
    id: String(row.id),
    description: String(row.description),
    amountMinor: Number(row.amount_minor),
    dueDate: String(row.due_date),
    periodStart: String(row.period_start),
    periodEnd: String(row.period_end),
    state: String(row.state),
    paymentExpenseId:
      row.payment_expense_id == null ? null : String(row.payment_expense_id),
  };
}

type CoffeeLineRow = { expense_id: string };
type CoffeeVisitRow = {
  id: string;
  visit_key: string;
  local_date: string;
  lines: CoffeeLineRow[] | null;
};

function toTargetCoffeeVisit(row: CoffeeVisitRow): MoneyImportTargetCoffeeVisit {
  const lines = Array.isArray(row.lines) ? row.lines : [];
  return {
    id: String(row.id),
    visitKey: String(row.visit_key),
    localDate: String(row.local_date),
    expenseIds: lines.map((line) => String(line.expense_id)),
  };
}

function insertPayload(
  actor: AuthenticatedActor,
  record: MoneyImportAdoptionWrite,
): Record<string, unknown> {
  return {
    owner_user_id: actor.userId,
    snapshot_id: record.snapshotId,
    snapshot_digest: record.snapshotDigest,
    manifest_digest: record.manifestDigest,
    source_identity: record.sourceIdentity,
    target_environment: record.targetEnvironment,
    opening_strategy: record.openingStrategy,
    cutover_date: record.cutoverDate,
    status: record.status,
    snapshot: record.snapshot,
    manifest: record.manifest,
    approval: record.approval,
    applied_counts: record.appliedCounts,
    post_reconciliation: record.postReconciliation,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    applied_at: record.appliedAt,
  };
}

export class SupabaseMoneyImportRepository implements MoneyImportRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listTargetMovements(
    actor: AuthenticatedActor,
    range: MoneyImportRange,
  ): Promise<RepositoryResult<MoneyImportTargetMovement[]>> {
    return this.pageRows<MovementRow, MoneyImportTargetMovement>(
      {
        table: LEDGER,
        columns: TARGET_MOVEMENT_COLUMNS,
        actor,
        range,
        dateColumn: "booking_date",
      },
      toTargetMovement,
    );
  }

  async listTargetMovementsBefore(
    actor: AuthenticatedActor,
    beforeDate: string,
    limit: number,
  ): Promise<RepositoryResult<MoneyImportTargetMovement[]>> {
    const bounded = Math.max(1, Math.min(1_000, Math.trunc(limit)));
    const { data, error } = await this.supabase
      .from(LEDGER)
      .select(TARGET_MOVEMENT_COLUMNS)
      .eq("owner_user_id", actor.userId)
      .lt("booking_date", beforeDate)
      .is("deleted_at", null)
      .order("booking_date", { ascending: false })
      .order("id", { ascending: false })
      .limit(bounded);
    if (error) return { ok: false, error: importFailure(error) };
    return {
      ok: true,
      value: ((data ?? []) as MovementRow[]).map(toTargetMovement),
    };
  }

  async listTargetObligations(
    actor: AuthenticatedActor,
    range: MoneyImportRange,
  ): Promise<RepositoryResult<MoneyImportTargetObligation[]>> {
    return this.pageRows<ObligationRow, MoneyImportTargetObligation>(
      {
        table: OBLIGATIONS,
        columns: TARGET_OBLIGATION_COLUMNS,
        actor,
        range,
        dateColumn: "due_date",
      },
      toTargetObligation,
    );
  }

  async listTargetCoffeeVisits(
    actor: AuthenticatedActor,
    range: MoneyImportRange,
  ): Promise<RepositoryResult<MoneyImportTargetCoffeeVisit[]>> {
    return this.pageRows<CoffeeVisitRow, MoneyImportTargetCoffeeVisit>(
      {
        table: COFFEE_VISITS,
        columns: TARGET_COFFEE_COLUMNS,
        actor,
        range,
        dateColumn: "local_date",
      },
      toTargetCoffeeVisit,
    );
  }

  private async pageRows<Row, Value>(
    query: Readonly<{
      table: string;
      columns: string;
      actor: AuthenticatedActor;
      range: MoneyImportRange;
      dateColumn: string;
    }>,
    map: (row: Row) => Value,
  ): Promise<RepositoryResult<Value[]>> {
    const values: Value[] = [];
    let offset = 0;
    while (offset < MAX_TARGET_ROWS) {
      let builder = this.supabase
        .from(query.table)
        .select(query.columns)
        .eq("owner_user_id", query.actor.userId)
        .gte(query.dateColumn, query.range.startDate)
        .lte(query.dateColumn, query.range.endDate);
      if (query.table === LEDGER) builder = builder.is("deleted_at", null);
      const { data, error } = await builder
        .order(query.dateColumn, { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) return { ok: false, error: importFailure(error) };
      const page = (data ?? []) as Row[];
      values.push(...page.map(map));
      if (page.length < PAGE_SIZE) return { ok: true, value: values };
      offset += PAGE_SIZE;
    }
    return { ok: false, error: { code: "unknown" } };
  }

  async getAdoption(
    actor: AuthenticatedActor,
    snapshotId: string,
  ): Promise<RepositoryResult<MoneyImportAdoptionRecord | null>> {
    const { data, error } = await this.supabase
      .from(ADOPTIONS)
      .select(ADOPTION_COLUMNS)
      .eq("owner_user_id", actor.userId)
      .eq("snapshot_id", snapshotId)
      .maybeSingle();
    if (error) return { ok: false, error: importFailure(error) };
    if (!data) return { ok: true, value: null };
    const record = toAdoptionRecord(data as AdoptionRow);
    if (!record) return { ok: false, error: { code: "unknown" } };
    return { ok: true, value: record };
  }

  async beginAdoption(
    actor: AuthenticatedActor,
    record: MoneyImportAdoptionWrite,
  ): Promise<RepositoryResult<MoneyImportAdoptionRecord>> {
    const { data, error } = await this.supabase
      .from(ADOPTIONS)
      .insert(insertPayload(actor, record))
      .select(ADOPTION_COLUMNS)
      .single();
    if (error) return { ok: false, error: importFailure(error) };
    if (!data) return { ok: false, error: { code: "unknown" } };
    const mapped = toAdoptionRecord(data as AdoptionRow);
    if (!mapped) return { ok: false, error: { code: "unknown" } };
    return { ok: true, value: mapped };
  }

  async completeAdoption(
    actor: AuthenticatedActor,
    record: MoneyImportAdoptionRecord,
  ): Promise<RepositoryResult<MoneyImportAdoptionRecord>> {
    return this.finishAdoption(actor, record, "adopted");
  }

  async markAdoptionReview(
    actor: AuthenticatedActor,
    record: MoneyImportAdoptionRecord,
  ): Promise<RepositoryResult<MoneyImportAdoptionRecord>> {
    return this.finishAdoption(actor, record, "review_needed");
  }

  private async finishAdoption(
    actor: AuthenticatedActor,
    record: MoneyImportAdoptionRecord,
    status: "adopted" | "review_needed",
  ): Promise<RepositoryResult<MoneyImportAdoptionRecord>> {
    const { data, error } = await this.supabase
      .from(ADOPTIONS)
      .update({
        status,
        applied_counts: record.appliedCounts,
        post_reconciliation: record.postReconciliation,
        applied_at: record.appliedAt,
        updated_at: record.updatedAt,
      })
      .eq("owner_user_id", actor.userId)
      .eq("snapshot_id", record.snapshotId)
      .eq("status", "applying")
      .select(ADOPTION_COLUMNS)
      .maybeSingle();
    if (error) return { ok: false, error: importFailure(error) };
    if (!data) return { ok: false, error: { code: "conflict" } };
    const mapped = toAdoptionRecord(data as AdoptionRow);
    if (!mapped) return { ok: false, error: { code: "unknown" } };
    return { ok: true, value: mapped };
  }

  async listMovementsByKeys(
    actor: AuthenticatedActor,
    keys: readonly string[],
  ): Promise<RepositoryResult<MoneyImportTargetMovement[]>> {
    const unique = [...new Set(keys.filter((key) => typeof key === "string" && key))];
    const rows: MoneyImportTargetMovement[] = [];
    for (let index = 0; index < unique.length; index += KEY_CHUNK_SIZE) {
      const chunk = unique.slice(index, index + KEY_CHUNK_SIZE);
      const { data, error } = await this.supabase
        .from(LEDGER)
        .select(TARGET_MOVEMENT_COLUMNS)
        .eq("owner_user_id", actor.userId)
        .in("idempotency_key", chunk)
        .is("deleted_at", null);
      if (error) return { ok: false, error: importFailure(error) };
      rows.push(...((data ?? []) as MovementRow[]).map(toTargetMovement));
    }
    return { ok: true, value: rows };
  }
}
