import type {
  AuthenticatedActor,
  MoneyCoffeeVisitCreateInput,
  MoneyCoffeeVisitListQuery,
  MoneyCoffeeVisitRepository,
  RepositoryFailure,
  RepositoryResult,
} from "@ega/application";
import type {
  MoneyCoffeeVisitLine,
  MoneyCoffeeVisitRecord,
} from "@ega/domain/money";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeSupabaseError } from "../supabase/errors";

/**
 * Request-scoped Supabase adapter for counted coffee visits.
 *
 * `money_coffee_visits` holds visit identity; `money_coffee_visit_lines` links
 * canonical `personal_expenses` rows. Amounts are read from the expense ledger,
 * never duplicated here. One expense can belong to at most one visit, and one
 * visit counts once no matter how many lines it has.
 */

const VISITS = "money_coffee_visits";
const LINES = "money_coffee_visit_lines";

const COLUMNS =
  "id, visit_key, visit_fingerprint, local_date, timezone, note, version, created_at, updated_at, lines:money_coffee_visit_lines(expense_id, expenses:personal_expenses(amount_minor, category, deleted_at))";

type LineRow = {
  expense_id: string;
  expenses:
    | {
        amount_minor: number;
        category: string;
        deleted_at: string | null;
      }
    | Array<{
        amount_minor: number;
        category: string;
        deleted_at: string | null;
      }>
    | null;
};

type VisitRow = {
  id: string;
  visit_key: string;
  visit_fingerprint: string;
  local_date: string;
  timezone: string;
  note: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  lines: LineRow[] | null;
};

function coffeeFailure(error: {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
} | null): RepositoryFailure {
  if (!error) return { code: "unknown" };
  if (error.code === "42501") return { code: "forbidden" };
  if (error.code === "23505") return { code: "conflict" };
  return sanitizeSupabaseError(error, { conflictCode: "__none__" });
}

function toLine(row: LineRow): MoneyCoffeeVisitLine | null {
  const expense = Array.isArray(row.expenses) ? row.expenses[0] : row.expenses;
  if (!expense) return null;
  return {
    expenseId: String(row.expense_id),
    amountMinor: Number(expense.amount_minor),
    category: String(expense.category),
    deletedAt: expense.deleted_at == null ? null : String(expense.deleted_at),
  };
}

function toRecord(row: VisitRow): MoneyCoffeeVisitRecord {
  const lines = (row.lines ?? [])
    .map(toLine)
    .filter((line): line is MoneyCoffeeVisitLine => line !== null);
  return {
    id: String(row.id),
    visitKey: String(row.visit_key),
    visitFingerprint: String(row.visit_fingerprint),
    localDate: String(row.local_date),
    timezone: String(row.timezone),
    note: row.note == null ? null : String(row.note),
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lines,
  };
}

export class SupabaseMoneyCoffeeRepository implements MoneyCoffeeVisitRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async findByVisitKey(
    actor: AuthenticatedActor,
    visitKey: string,
  ): Promise<RepositoryResult<MoneyCoffeeVisitRecord | null>> {
    const { data, error } = await this.supabase
      .from(VISITS)
      .select(COLUMNS)
      .eq("owner_user_id", actor.userId)
      .eq("visit_key", visitKey)
      .maybeSingle();
    if (error) return { ok: false, error: coffeeFailure(error) };
    if (!data) return { ok: true, value: null };
    return { ok: true, value: toRecord(data as VisitRow) };
  }

  async getVisit(
    actor: AuthenticatedActor,
    id: string,
  ): Promise<RepositoryResult<MoneyCoffeeVisitRecord | null>> {
    const { data, error } = await this.supabase
      .from(VISITS)
      .select(COLUMNS)
      .eq("owner_user_id", actor.userId)
      .eq("id", id)
      .maybeSingle();
    if (error) return { ok: false, error: coffeeFailure(error) };
    if (!data) return { ok: true, value: null };
    return { ok: true, value: toRecord(data as VisitRow) };
  }

  async createVisit(
    actor: AuthenticatedActor,
    input: MoneyCoffeeVisitCreateInput,
  ): Promise<RepositoryResult<MoneyCoffeeVisitRecord>> {
    const { data, error } = await this.supabase
      .from(VISITS)
      .insert({
        owner_user_id: actor.userId,
        visit_key: input.values.visitKey,
        visit_fingerprint: input.visitFingerprint,
        local_date: input.values.localDate,
        timezone: input.values.timezone,
        note: input.values.note,
        created_at: input.createdAt,
        updated_at: input.createdAt,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: coffeeFailure(error) };
    if (!data) return { ok: false, error: { code: "unknown" } };
    const visitId = String((data as { id: string }).id);

    const lines = input.values.expenseIds.map((expenseId) => ({
      owner_user_id: actor.userId,
      visit_id: visitId,
      expense_id: expenseId,
    }));
    const { error: linesError } = await this.supabase.from(LINES).insert(lines);
    if (linesError) {
      // Compensate the partial insert: the ledger itself is untouched, but a
      // visit without its lines would be a misleading counted visit.
      await this.supabase
        .from(VISITS)
        .delete()
        .eq("owner_user_id", actor.userId)
        .eq("id", visitId);
      return { ok: false, error: coffeeFailure(linesError) };
    }

    const created = await this.getVisit(actor, visitId);
    if (!created.ok) return created;
    if (!created.value) return { ok: false, error: { code: "unknown" } };
    return { ok: true, value: created.value };
  }

  async listVisits(
    actor: AuthenticatedActor,
    query: MoneyCoffeeVisitListQuery,
  ): Promise<RepositoryResult<MoneyCoffeeVisitRecord[]>> {
    const { data, error } = await this.supabase
      .from(VISITS)
      .select(COLUMNS)
      .eq("owner_user_id", actor.userId)
      .gte("local_date", query.from)
      .lte("local_date", query.to)
      .order("local_date", { ascending: false })
      .order("id", { ascending: false })
      .range(query.offset, query.offset + query.limit - 1);
    if (error) return { ok: false, error: coffeeFailure(error) };
    return {
      ok: true,
      value: ((data ?? []) as VisitRow[]).map(toRecord),
    };
  }

  async deleteVisit(
    actor: AuthenticatedActor,
    id: string,
    expectedVersion: number,
    deletedAt: string,
  ): Promise<RepositoryResult<Readonly<{ id: string; alreadyDeleted: boolean }>>> {
    const current = await this.supabase
      .from(VISITS)
      .select("version")
      .eq("owner_user_id", actor.userId)
      .eq("id", id)
      .maybeSingle();
    if (current.error) return { ok: false, error: coffeeFailure(current.error) };
    if (!current.data) return { ok: false, error: { code: "notFound" } };
    const version = Number((current.data as { version: number }).version);
    if (version !== expectedVersion) {
      return { ok: false, error: { code: "conflict" } };
    }

    const lines = await this.supabase
      .from(LINES)
      .delete()
      .eq("owner_user_id", actor.userId)
      .eq("visit_id", id);
    if (lines.error) return { ok: false, error: coffeeFailure(lines.error) };

    const removed = await this.supabase
      .from(VISITS)
      .delete()
      .eq("owner_user_id", actor.userId)
      .eq("id", id)
      .eq("version", expectedVersion)
      .select("id")
      .maybeSingle();
    if (removed.error) return { ok: false, error: coffeeFailure(removed.error) };
    if (!removed.data) return { ok: false, error: { code: "conflict" } };
    void deletedAt;
    return { ok: true, value: { id, alreadyDeleted: false } };
  }

  async listVisitIdsForExpense(
    actor: AuthenticatedActor,
    expenseId: string,
  ): Promise<RepositoryResult<string[]>> {
    const { data, error } = await this.supabase
      .from(LINES)
      .select("visit_id")
      .eq("owner_user_id", actor.userId)
      .eq("expense_id", expenseId);
    if (error) return { ok: false, error: coffeeFailure(error) };
    return {
      ok: true,
      value: ((data ?? []) as Array<{ visit_id: string }>).map((row) =>
        String(row.visit_id),
      ),
    };
  }
}
