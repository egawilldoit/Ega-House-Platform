import {
  parseExpenseListQuery,
  type PersonalExpense,
} from "@ega/domain/expenses";

import type { AuthenticatedActor } from "../auth/actor";
import {
  applicationFailure,
  applicationSuccess,
  type ApplicationResult,
  type RepositoryFailure,
} from "../shared/result";
import type { ExpenseRepository } from "./ports";

/**
 * Complete owner-scoped export (MONEY-02).
 *
 * The previous CSV route requested one page of 10,000 rows, so a larger range
 * was silently truncated. This use case pages through the canonical repository
 * until the range is exhausted and refuses explicitly when the row budget is
 * exceeded. It never returns a partial result as if it were complete.
 */
export const EXPENSE_EXPORT_PAGE_SIZE = 500;
export const EXPENSE_EXPORT_MAX_ROWS = 50_000;

export type ExpenseExportInput = Readonly<{
  from: string;
  to: string;
  timezone: string;
  maxRows?: number;
}>;

export type ExpenseExportOutcome = Readonly<{
  expenses: PersonalExpense[];
  recordCount: number;
}>;

function failureFor(code: RepositoryFailure["code"] | undefined): ApplicationResult<never> {
  if (code === "forbidden") {
    return applicationFailure(
      "You do not have permission to export these expenses.",
      "forbidden",
    );
  }
  if (code === "notFound" || code === "conflict") {
    return applicationFailure("Unable to export expenses right now.", "unknown");
  }
  return applicationFailure("Unable to export expenses right now.", "unknown");
}

/**
 * Page the repository with the same validated owner-local window the Money
 * list uses. The caller supplies a bounded date range and timezone; owner
 * identity comes only from the verified actor.
 */
export async function exportExpenses(
  actor: AuthenticatedActor,
  repository: ExpenseRepository,
  input: ExpenseExportInput,
): Promise<ApplicationResult<ExpenseExportOutcome>> {
  const maxRows = input.maxRows ?? EXPENSE_EXPORT_MAX_ROWS;
  if (!Number.isInteger(maxRows) || maxRows < 1) {
    return applicationFailure("Export row budget is invalid.", "validation");
  }

  // Reuse the shared date/timezone/window validation. The list API's 100-row
  // limit does not constrain this internal repository page size: the export
  // walks the same repository in bounded pages below.
  const parsed = parseExpenseListQuery({
    from: input.from,
    to: input.to,
    timezone: input.timezone,
    limit: "1",
    offset: "0",
  });
  if (!parsed.ok) {
    return applicationFailure(parsed.message, "validation");
  }

  const query = parsed.value;
  if (!query.startUtcIso || !query.endUtcExclusiveIso) {
    return applicationFailure("Export requires a complete date range.", "validation");
  }
  const window = {
    startUtcIso: query.startUtcIso,
    endUtcExclusiveIso: query.endUtcExclusiveIso,
  };

  // Refuse an oversized range before reading any rows.
  const counted = await repository.count(actor, window);
  if (!counted.ok) return failureFor(counted.error.code);
  if (counted.value > maxRows) {
    return applicationFailure(
      `This export contains more than ${maxRows.toLocaleString("en-US")} expenses. Narrow the date range and try again.`,
      "validation",
    );
  }
  if (counted.value === 0) {
    return applicationSuccess({ expenses: [], recordCount: 0 });
  }

  const expenses: PersonalExpense[] = [];
  let cursor: { occurredAt: string; id: string } | null = null;

  for (;;) {
    // Keyset paging rather than offset: a concurrent delete cannot shift an
    // unread row before the next offset and silently omit it.
    const page = await repository.list(actor, {
      limit: EXPENSE_EXPORT_PAGE_SIZE,
      offset: 0,
      startUtcIso: window.startUtcIso,
      endUtcExclusiveIso: window.endUtcExclusiveIso,
      beforeOccurredAt: cursor?.occurredAt ?? null,
      beforeId: cursor?.id ?? null,
    });
    if (!page.ok) return failureFor(page.error.code);
    if (page.value.length === 0) break;

    expenses.push(...page.value);
    if (expenses.length > maxRows) {
      return applicationFailure(
        `This export contains more than ${maxRows.toLocaleString("en-US")} expenses. Narrow the date range and try again.`,
        "validation",
      );
    }

    const last = page.value[page.value.length - 1];
    if (cursor && cursor.occurredAt === last.occurredAt && cursor.id === last.id) {
      return applicationFailure(
        "The ledger changed during this export. Retry to get a complete file.",
        "conflict",
      );
    }
    cursor = { occurredAt: last.occurredAt, id: last.id };
    if (page.value.length < EXPENSE_EXPORT_PAGE_SIZE) break;
  }

  // Insert/delete between the initial count and the walk means the walk is not
  // a complete representation of the counted set. Refuse rather than return a
  // silently incomplete CSV.
  if (expenses.length !== counted.value) {
    return applicationFailure(
      "The ledger changed during this export. Retry to get a complete file.",
      "conflict",
    );
  }

  return applicationSuccess({
    expenses,
    recordCount: expenses.length,
  });
}
