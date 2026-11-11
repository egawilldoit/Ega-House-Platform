import type {
  AuthenticatedActor,
  MoneyLedgerDirectionTotals,
  MoneyLedgerOverview,
  MoneyLedgerWindow,
  MoneyPeriodCreateRecordInput,
  MoneyPeriodRepository,
  MoneyPeriodUpdateRecordInput,
  RepositoryFailure,
  RepositoryResult,
} from "@ega/application";
import type {
  MoneyOpening,
  MoneyOpeningCorrection,
  MoneyOpeningProvenance,
  MoneyPeriod,
  MoneyPeriodInitialization,
  MoneyPeriodLifecycle,
  MoneyPeriodProvenance,
  MoneyPeriodSettings,
} from "@ega/domain/money";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeSupabaseError } from "../supabase/errors";

/**
 * Request-scoped Supabase adapter for period and opening state. RLS remains
 * authoritative; every statement filters by the verified actor's owner id as
 * defense in depth. The two multi-row writes go through the atomic
 * `money_create_period` / `money_update_period` RPCs, which take the owner from
 * `auth.uid()` and never from a parameter.
 */

const PERIOD_TABLE = "money_periods";
const LEDGER_TABLE = "personal_expenses";

const PERIOD_COLUMNS =
  "id, owner_user_id, start_date, end_date, currency, timezone, active_date, lifecycle, initialization, opening_movement_id, provenance, settings, version, created_at, updated_at";

const OPENING_COLUMNS =
  "id, amount_minor, currency, booking_date, version, created_at, updated_at";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

function firstRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    const first = data[0];
    return isRecord(first) ? first : null;
  }
  return isRecord(data) ? data : null;
}

export class SupabaseMoneyPeriodRepository implements MoneyPeriodRepository {
  constructor(private readonly supabase: SupabaseClient) {}

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
