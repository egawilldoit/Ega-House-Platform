import type {
  AuthenticatedActor,
  ObligationCreateRecordInput,
  ObligationIdempotencyReceipt,
  ObligationListRecordQuery,
  ObligationRepository,
  ObligationTemplateCreateRecordInput,
  ObligationTemplateIdempotencyReceipt,
  ObligationTemplateListRecordQuery,
  ObligationTemplateUpdateRecordInput,
  ObligationTransitionRecordInput,
  ObligationUpdateRecordInput,
  RepositoryFailure,
  RepositoryResult,
} from "@ega/application";
import {
  OBLIGATION_CURRENCY,
  type ObligationCadence,
  type ObligationHistoricalImportEvidence,
  type ObligationKind,
  type ObligationOccurrence,
  type ObligationState,
  type ObligationStateEvent,
  type ObligationTemplate,
  type ObligationTemplateLifecycle,
} from "@ega/domain/obligations";
import type { ExpenseCategory, ExpenseNeedVsWant } from "@ega/domain/expenses";
import type { MoneyPurpose } from "@ega/domain/money";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeSupabaseError } from "../supabase/errors";

/**
 * Request-scoped Supabase adapter for MONEY-06 obligations. RLS remains
 * authoritative; every statement also filters `owner_user_id` from the verified
 * actor as defense in depth. Templates and occurrences are separate tables:
 * occurrences snapshot their classification so template edits cannot rewrite
 * history, and only a linked canonical payment makes an occurrence `paid`.
 */

const OCCURRENCES = "money_obligations";
const TEMPLATES = "money_obligation_templates";

const OCCURRENCE_COLUMNS =
  "id, template_id, kind, description, amount_minor, currency, period_start, period_end, due_date, need_vs_want, purpose, counts_in_daily, category, state, state_effective_date, state_reason, state_history, payment_expense_id, payment_evidence, idempotency_key, version, created_at, updated_at";

const OCCURRENCE_COLUMNS_WITH_FINGERPRINT = `${OCCURRENCE_COLUMNS}, create_fingerprint`;

const TEMPLATE_COLUMNS =
  "id, kind, description, amount_minor, currency, cadence, due_day_of_month, due_weekday, start_date, end_date, need_vs_want, purpose, counts_in_daily, category, lifecycle, idempotency_key, version, created_at, updated_at";

const TEMPLATE_COLUMNS_WITH_FINGERPRINT = `${TEMPLATE_COLUMNS}, create_fingerprint`;

export type ObligationRow = {
  id: string;
  template_id: string | null;
  kind: string;
  description: string;
  amount_minor: number;
  currency: string;
  period_start: string;
  period_end: string;
  due_date: string;
  need_vs_want: string | null;
  purpose: string;
  counts_in_daily: boolean;
  category: string | null;
  state: string;
  state_effective_date: string;
  state_reason: string | null;
  state_history: unknown;
  payment_expense_id: string | null;
  payment_evidence: unknown;
  idempotency_key: string;
  version: number;
  created_at: string;
  updated_at: string;
};

type ObligationIdempotencyRow = ObligationRow & { create_fingerprint: string };

type ObligationTemplateRow = {
  id: string;
  kind: string;
  description: string;
  amount_minor: number;
  currency: string;
  cadence: string;
  due_day_of_month: number | null;
  due_weekday: number | null;
  start_date: string;
  end_date: string | null;
  need_vs_want: string | null;
  purpose: string | null;
  counts_in_daily: boolean | null;
  category: string | null;
  lifecycle: string;
  idempotency_key: string;
  version: number;
  created_at: string;
  updated_at: string;
};

type ObligationTemplateIdempotencyRow = ObligationTemplateRow & {
  create_fingerprint: string;
};

type ObligationSupabaseError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  constraint?: string;
} | null;

/**
 * Obligation-local failure mapping. Permission failures become `forbidden`;
 * every unique violation is a `conflict` because create disambiguates the
 * idempotency receipt from the template/period identity by re-reading. All
 * other errors stay `unknown` rather than looking like a replay.
 */
function obligationFailure(error: ObligationSupabaseError): RepositoryFailure {
  if (!error) return { code: "unknown" };
  if (error.code === "42501") return { code: "forbidden" };
  if (error.code === "23505") return { code: "conflict" };
  return sanitizeSupabaseError(error, { conflictCode: "__none__" });
}

function optionalString(value: string | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

function toPaymentEvidence(
  value: unknown,
): ObligationHistoricalImportEvidence | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.kind !== "reconciled_historical_import") return null;
  const reference = typeof record.reference === "string" ? record.reference : "";
  if (!reference.trim()) return null;
  return {
    kind: "reconciled_historical_import",
    reference,
    note: typeof record.note === "string" ? record.note : null,
    importedAt: typeof record.importedAt === "string" ? record.importedAt : "",
  };
}

function toStateHistory(raw: unknown): ObligationStateEvent[] {
  if (!Array.isArray(raw)) return [];
  const events: ObligationStateEvent[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const value = item as Record<string, unknown>;
    if (
      typeof value.state !== "string" ||
      typeof value.effectiveDate !== "string" ||
      typeof value.version !== "number" ||
      typeof value.recordedAt !== "string"
    ) {
      continue;
    }
    events.push({
      state: value.state as ObligationState,
      effectiveDate: value.effectiveDate,
      reason: typeof value.reason === "string" ? value.reason : null,
      version: value.version,
      recordedAt: value.recordedAt,
    });
  }
  return events;
}

/**
 * Map one stored occurrence row onto the canonical domain shape. Shared with
 * the MONEY-07 payment adapter, which reads the occurrence back from the same
 * atomic transaction that wrote it.
 */
export function toObligationOccurrence(row: ObligationRow): ObligationOccurrence {
  return {
    id: String(row.id),
    kind: String(row.kind) as ObligationKind,
    description: String(row.description),
    amountMinor: Number(row.amount_minor),
    currency: OBLIGATION_CURRENCY,
    periodStart: String(row.period_start),
    periodEnd: String(row.period_end),
    dueDate: String(row.due_date),
    needVsWant:
      row.need_vs_want === null
        ? null
        : (String(row.need_vs_want) as ExpenseNeedVsWant),
    purpose: String(row.purpose) as MoneyPurpose,
    countsInDaily: Boolean(row.counts_in_daily),
    category:
      row.category === null ? null : (String(row.category) as ExpenseCategory),
    state: String(row.state) as ObligationState,
    stateEffectiveDate: String(row.state_effective_date),
    stateReason: optionalString(row.state_reason),
    stateHistory: toStateHistory(row.state_history),
    paymentExpenseId: optionalString(row.payment_expense_id),
    paymentEvidence: toPaymentEvidence(row.payment_evidence),
    templateId: optionalString(row.template_id),
    idempotencyKey: String(row.idempotency_key),
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toTemplate(row: ObligationTemplateRow): ObligationTemplate {
  return {
    id: String(row.id),
    kind: String(row.kind) as ObligationKind,
    description: String(row.description),
    amountMinor: Number(row.amount_minor),
    currency: OBLIGATION_CURRENCY,
    cadence: String(row.cadence) as ObligationCadence,
    dueDayOfMonth:
      row.due_day_of_month === null ? null : Number(row.due_day_of_month),
    dueWeekday: row.due_weekday === null ? null : Number(row.due_weekday),
    startDate: String(row.start_date),
    endDate: optionalString(row.end_date),
    needVsWant:
      row.need_vs_want === null
        ? null
        : (String(row.need_vs_want) as ExpenseNeedVsWant),
    purpose:
      row.purpose === null ? null : (String(row.purpose) as MoneyPurpose),
    countsInDaily:
      row.counts_in_daily === null ? null : Boolean(row.counts_in_daily),
    category:
      row.category === null ? null : (String(row.category) as ExpenseCategory),
    lifecycle: String(row.lifecycle) as ObligationTemplateLifecycle,
    idempotencyKey: String(row.idempotency_key),
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toOccurrenceInsertPayload(
  actor: AuthenticatedActor,
  input: ObligationCreateRecordInput,
): Record<string, unknown> {
  const values = input.values;
  return {
    owner_user_id: actor.userId,
    template_id: values.templateId,
    kind: values.kind,
    description: values.description,
    amount_minor: values.amountMinor,
    currency: OBLIGATION_CURRENCY,
    period_start: values.periodStart,
    period_end: values.periodEnd,
    due_date: values.dueDate,
    need_vs_want: values.needVsWant,
    purpose: values.purpose,
    counts_in_daily: values.countsInDaily,
    category: values.category,
    // Creation never accepts a caller-supplied state or payment: the DB
    // defaults enforce pending with empty lifecycle history.
    state_effective_date: values.stateEffectiveDate,
    idempotency_key: values.idempotencyKey,
    create_fingerprint: input.createFingerprint,
  };
}

function toOccurrenceUpdatePayload(
  input: ObligationUpdateRecordInput,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    updated_at: input.updatedAt,
    version: input.expectedVersion + 1,
  };
  const changes = input.changes;
  if (changes.description !== undefined) payload.description = changes.description;
  if (changes.amountMinor !== undefined) payload.amount_minor = changes.amountMinor;
  if (changes.periodStart !== undefined) payload.period_start = changes.periodStart;
  if (changes.periodEnd !== undefined) payload.period_end = changes.periodEnd;
  if (changes.dueDate !== undefined) payload.due_date = changes.dueDate;
  if (changes.needVsWant !== undefined) payload.need_vs_want = changes.needVsWant;
  if (changes.purpose !== undefined) payload.purpose = changes.purpose;
  if (changes.countsInDaily !== undefined) {
    payload.counts_in_daily = changes.countsInDaily;
  }
  if (changes.category !== undefined) payload.category = changes.category;
  return payload;
}

function toTemplateInsertPayload(
  actor: AuthenticatedActor,
  input: ObligationTemplateCreateRecordInput,
): Record<string, unknown> {
  const values = input.values;
  return {
    owner_user_id: actor.userId,
    kind: values.kind,
    description: values.description,
    amount_minor: values.amountMinor,
    currency: OBLIGATION_CURRENCY,
    cadence: values.cadence,
    due_day_of_month: values.dueDayOfMonth,
    due_weekday: values.dueWeekday,
    start_date: values.startDate,
    end_date: values.endDate,
    need_vs_want: values.needVsWant,
    purpose: values.purpose,
    counts_in_daily: values.countsInDaily,
    category: values.category,
    lifecycle: "active",
    idempotency_key: values.idempotencyKey,
    create_fingerprint: input.createFingerprint,
  };
}

function toTemplateUpdatePayload(
  input: ObligationTemplateUpdateRecordInput,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    updated_at: input.updatedAt,
    version: input.expectedVersion + 1,
  };
  const changes = input.changes;
  if (changes.description !== undefined) payload.description = changes.description;
  if (changes.amountMinor !== undefined) payload.amount_minor = changes.amountMinor;
  if (changes.cadence !== undefined) payload.cadence = changes.cadence;
  if (changes.dueDayOfMonth !== undefined) {
    payload.due_day_of_month = changes.dueDayOfMonth;
  }
  if (changes.dueWeekday !== undefined) payload.due_weekday = changes.dueWeekday;
  if (changes.startDate !== undefined) payload.start_date = changes.startDate;
  if (changes.endDate !== undefined) payload.end_date = changes.endDate;
  if (changes.needVsWant !== undefined) payload.need_vs_want = changes.needVsWant;
  if (changes.purpose !== undefined) payload.purpose = changes.purpose;
  if (changes.countsInDaily !== undefined) {
    payload.counts_in_daily = changes.countsInDaily;
  }
  if (changes.category !== undefined) payload.category = changes.category;
  if (changes.lifecycle !== undefined) payload.lifecycle = changes.lifecycle;
  return payload;
}

export class SupabaseObligationRepository implements ObligationRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async findByIdempotencyKey(
    actor: AuthenticatedActor,
    idempotencyKey: string,
  ): Promise<RepositoryResult<ObligationIdempotencyReceipt | null>> {
    const { data, error } = await this.supabase
      .from(OCCURRENCES)
      .select(OCCURRENCE_COLUMNS_WITH_FINGERPRINT)
      .eq("owner_user_id", actor.userId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (error) return { ok: false, error: obligationFailure(error) };
    if (!data) return { ok: true, value: null };
    const row = data as ObligationIdempotencyRow;
    return {
      ok: true,
      value: {
        occurrence: toObligationOccurrence(row),
        createFingerprint: String(row.create_fingerprint),
      },
    };
  }

  async create(
    actor: AuthenticatedActor,
    input: ObligationCreateRecordInput,
  ): Promise<RepositoryResult<ObligationOccurrence>> {
    const { data, error } = await this.supabase
      .from(OCCURRENCES)
      .insert(toOccurrenceInsertPayload(actor, input))
      .select(OCCURRENCE_COLUMNS)
      .single();

    if (error) return { ok: false, error: obligationFailure(error) };
    if (!data) return { ok: false, error: { code: "unknown" } };
    return { ok: true, value: toObligationOccurrence(data as ObligationRow) };
  }

  async get(
    actor: AuthenticatedActor,
    id: string,
  ): Promise<RepositoryResult<ObligationOccurrence | null>> {
    const { data, error } = await this.supabase
      .from(OCCURRENCES)
      .select(OCCURRENCE_COLUMNS)
      .eq("owner_user_id", actor.userId)
      .eq("id", id)
      .maybeSingle();

    if (error) return { ok: false, error: obligationFailure(error) };
    if (!data) return { ok: true, value: null };
    return { ok: true, value: toObligationOccurrence(data as ObligationRow) };
  }

  async list(
    actor: AuthenticatedActor,
    query: ObligationListRecordQuery,
  ): Promise<RepositoryResult<ObligationOccurrence[]>> {
    let request = this.supabase
      .from(OCCURRENCES)
      .select(OCCURRENCE_COLUMNS)
      .eq("owner_user_id", actor.userId);

    if (query.kind) request = request.eq("kind", query.kind);
    if (query.state) request = request.eq("state", query.state);
    if (query.dueFrom) request = request.gte("due_date", query.dueFrom);
    if (query.dueTo) request = request.lte("due_date", query.dueTo);

    const { data, error } = await request
      .order("due_date", { ascending: true })
      .order("id", { ascending: true })
      .range(query.offset, query.offset + query.limit - 1);

    if (error) return { ok: false, error: obligationFailure(error) };
    const rows = (data ?? []) as ObligationRow[];
    return { ok: true, value: rows.map(toObligationOccurrence) };
  }

  async update(
    actor: AuthenticatedActor,
    id: string,
    input: ObligationUpdateRecordInput,
  ): Promise<RepositoryResult<ObligationOccurrence>> {
    const { data, error } = await this.supabase
      .from(OCCURRENCES)
      .update(toOccurrenceUpdatePayload(input))
      .eq("owner_user_id", actor.userId)
      .eq("id", id)
      .eq("version", input.expectedVersion)
      .select(OCCURRENCE_COLUMNS)
      .maybeSingle();

    if (error) return { ok: false, error: obligationFailure(error) };
    if (data) return { ok: true, value: toObligationOccurrence(data as ObligationRow) };
    return { ok: false, error: await this.classifyWriteMiss(actor, id) };
  }

  async transition(
    actor: AuthenticatedActor,
    id: string,
    input: ObligationTransitionRecordInput,
  ): Promise<RepositoryResult<ObligationOccurrence>> {
    const { data, error } = await this.supabase
      .from(OCCURRENCES)
      .update({
        state: input.to,
        state_effective_date: input.effectiveDate,
        state_reason: input.reason,
        version: input.expectedVersion + 1,
        updated_at: input.updatedAt,
      })
      .eq("owner_user_id", actor.userId)
      .eq("id", id)
      .eq("version", input.expectedVersion)
      .eq("state", input.fromState)
      .select(OCCURRENCE_COLUMNS)
      .maybeSingle();

    if (error) return { ok: false, error: obligationFailure(error) };
    if (data) return { ok: true, value: toObligationOccurrence(data as ObligationRow) };
    return { ok: false, error: await this.classifyWriteMiss(actor, id) };
  }

  /**
   * Distinguish a missing occurrence from a stale version/state so the
   * transport can answer 404 vs 409 accurately.
   */
  private async classifyWriteMiss(
    actor: AuthenticatedActor,
    id: string,
  ): Promise<RepositoryFailure> {
    const current = await this.supabase
      .from(OCCURRENCES)
      .select("id")
      .eq("owner_user_id", actor.userId)
      .eq("id", id)
      .maybeSingle();
    if (current.error) return obligationFailure(current.error);
    return current.data ? { code: "conflict" } : { code: "notFound" };
  }

  async findTemplateByIdempotencyKey(
    actor: AuthenticatedActor,
    idempotencyKey: string,
  ): Promise<RepositoryResult<ObligationTemplateIdempotencyReceipt | null>> {
    const { data, error } = await this.supabase
      .from(TEMPLATES)
      .select(TEMPLATE_COLUMNS_WITH_FINGERPRINT)
      .eq("owner_user_id", actor.userId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (error) return { ok: false, error: obligationFailure(error) };
    if (!data) return { ok: true, value: null };
    const row = data as ObligationTemplateIdempotencyRow;
    return {
      ok: true,
      value: {
        template: toTemplate(row),
        createFingerprint: String(row.create_fingerprint),
      },
    };
  }

  async createTemplate(
    actor: AuthenticatedActor,
    input: ObligationTemplateCreateRecordInput,
  ): Promise<RepositoryResult<ObligationTemplate>> {
    const { data, error } = await this.supabase
      .from(TEMPLATES)
      .insert(toTemplateInsertPayload(actor, input))
      .select(TEMPLATE_COLUMNS)
      .single();

    if (error) return { ok: false, error: obligationFailure(error) };
    if (!data) return { ok: false, error: { code: "unknown" } };
    return { ok: true, value: toTemplate(data as ObligationTemplateRow) };
  }

  async getTemplate(
    actor: AuthenticatedActor,
    id: string,
  ): Promise<RepositoryResult<ObligationTemplate | null>> {
    const { data, error } = await this.supabase
      .from(TEMPLATES)
      .select(TEMPLATE_COLUMNS)
      .eq("owner_user_id", actor.userId)
      .eq("id", id)
      .maybeSingle();

    if (error) return { ok: false, error: obligationFailure(error) };
    if (!data) return { ok: true, value: null };
    return { ok: true, value: toTemplate(data as ObligationTemplateRow) };
  }

  async listTemplates(
    actor: AuthenticatedActor,
    query: ObligationTemplateListRecordQuery,
  ): Promise<RepositoryResult<ObligationTemplate[]>> {
    let request = this.supabase
      .from(TEMPLATES)
      .select(TEMPLATE_COLUMNS)
      .eq("owner_user_id", actor.userId);

    if (query.kind) request = request.eq("kind", query.kind);
    if (!query.includeArchived) request = request.eq("lifecycle", "active");

    const { data, error } = await request
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (error) return { ok: false, error: obligationFailure(error) };
    const rows = (data ?? []) as ObligationTemplateRow[];
    return { ok: true, value: rows.map(toTemplate) };
  }

  async updateTemplate(
    actor: AuthenticatedActor,
    id: string,
    input: ObligationTemplateUpdateRecordInput,
  ): Promise<RepositoryResult<ObligationTemplate>> {
    const { data, error } = await this.supabase
      .from(TEMPLATES)
      .update(toTemplateUpdatePayload(input))
      .eq("owner_user_id", actor.userId)
      .eq("id", id)
      .eq("version", input.expectedVersion)
      .select(TEMPLATE_COLUMNS)
      .maybeSingle();

    if (error) return { ok: false, error: obligationFailure(error) };
    if (data) return { ok: true, value: toTemplate(data as ObligationTemplateRow) };

    const current = await this.supabase
      .from(TEMPLATES)
      .select("id")
      .eq("owner_user_id", actor.userId)
      .eq("id", id)
      .maybeSingle();
    if (current.error) return { ok: false, error: obligationFailure(current.error) };
    return {
      ok: false,
      error: current.data ? { code: "conflict" } : { code: "notFound" },
    };
  }
}
