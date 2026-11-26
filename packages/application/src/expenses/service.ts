import {
  canonicalExpenseCreatePayload,
  isExpenseId,
  parseCreateExpenseInput,
  parseExpenseListQuery,
  parseUpdateExpenseInput,
  type ExpenseCreateValues,
  type ExpenseListValues,
  type PersonalExpense,
} from "@ega/domain/expenses";
import {
  MONEY_DEFAULT_TIMEZONE,
  defaultCountsInDaily,
  moneyBookingDateEditable,
} from "@ega/domain/money";
import {
  addDaysToIsoDate,
  getLocalDateInTimezone,
} from "@ega/domain/time-context";

import type { AuthenticatedActor } from "../auth/actor";
import type { MoneyPeriodRepository } from "../money/ports";
import {
  resolveRoutineEntry,
  type MoneyRoutineEntryTarget,
} from "../money/periods";
import { sha256Hex } from "../shared/hash";
import {
  applicationFailure,
  applicationSuccess,
  type ApplicationErrorCode,
  type ApplicationResult,
  type RepositoryFailure,
  type RepositoryResult,
} from "../shared/result";
import type { ExpenseIdempotencyReceipt, ExpenseRepository } from "./ports";

/**
 * Expense use cases (PO-06 Slice A, issue #346).
 *
 * The actor always comes from verified authentication. Callers submit only
 * expense fields; owner identity is never accepted from a payload. Validation
 * happens here before persistence, and repository failures are mapped onto the
 * small application error vocabulary the Hono transport understands.
 */

export type CreateExpenseOutcome = Readonly<{
  expense: PersonalExpense;
  replayed: boolean;
}>;

export type ExpenseListOutcome = Readonly<{
  expenses: PersonalExpense[];
  pagination: Readonly<{
    limit: number;
    offset: number;
    hasMore: boolean;
    /** Offset for the next page, or null when this is the last page. */
    nextOffset: number | null;
  }>;
}>;

/**
 * Fixed-size idempotency receipt. The canonical create payload is hashed in
 * the application layer (where `node:crypto` is allowed) so the database never
 * stores a second copy of the raw note, merchant or amount. SHA-256 hex is 64
 * characters and collision resistance is sufficient for this receipt.
 */
export function expenseReceiptFingerprint(values: ExpenseCreateValues): string {
  return sha256Hex(canonicalExpenseCreatePayload(values));
}

const IDEMPOTENCY_CONFLICT =
  "That idempotency key was already used for a different expense.";
const NOT_FOUND = "Expense was not found or is no longer available.";

function failureFor(
  code: RepositoryFailure["code"] | undefined,
  fallback: string,
): ApplicationResult<never> {
  if (!code || code === "unknown") return applicationFailure(fallback);
  return applicationFailure(
    code === "notFound"
      ? NOT_FOUND
      : code === "conflict"
        ? "The expense changed. Refresh and try again."
        : "You do not have permission to change this expense.",
    code as ApplicationErrorCode,
  );
}

function fromRepository<T>(
  result: RepositoryResult<T>,
  fallback: string,
): ApplicationResult<T> {
  if (result.ok) return applicationSuccess(result.value);
  return failureFor(result.error.code, fallback);
}

function validateId(id: unknown): string | null {
  return typeof id === "string" && isExpenseId(id.trim()) ? id.trim() : null;
}

function replayOutcome(
  existing: ExpenseIdempotencyReceipt,
  createFingerprint: string,
): ApplicationResult<CreateExpenseOutcome> {
  if (existing.createFingerprint !== createFingerprint) {
    return applicationFailure(IDEMPOTENCY_CONFLICT, "conflict");
  }
  return applicationSuccess({ expense: existing.expense, replayed: true });
}

export type CreateExpenseOptions = Readonly<{
  /**
   * Optional period guard. When supplied, a configured tracking period owns
   * its inclusive range, a non-finalized `superseded` period still owns its own
   * dates, and a later date asks the database to continue atomically. Ended
   * and rolled-over ranges are historical corrections. Accounts with no period
   * keep the existing behavior.
   */
  periods?: Pick<
    MoneyPeriodRepository,
    "findTracking" | "list" | "findOverlapping"
  > &
    Partial<Pick<MoneyPeriodRepository, "findById">>;
  /** The instant that defines owner-local today; defaults to now. */
  now?: Date;
}>;

/**
 * One routine-entry gate for routine writes, shared by create and by any
 * update that moves the booking instant. The application layer is canonical:
 * it resolves the target period (or asks the database to continue atomically),
 * so the same rule covers the expense surfaces, the Money quick entry, HTTP and
 * MCP.
 */
async function routineEntryGuard(
  actor: AuthenticatedActor,
  periods: NonNullable<CreateExpenseOptions["periods"]>,
  entry: Readonly<{ occurredAt?: string; bookingDate?: string }>,
  now: Date = new Date(),
): Promise<ApplicationResult<MoneyRoutineEntryTarget | null>> {
  const tracking = await periods.findTracking(actor);
  if (!tracking.ok) {
    return failureFor(
      tracking.error.code,
      "Unable to check the tracking period right now.",
    );
  }
  // A timestamped write is resolved in the period timezone and must not be
  // overridden by an explicit stale bookingDate. When no period is tracking,
  // the latest retained period is the timezone anchor for a superseded
  // re-record. The DB derives the same day from the timestamp and period.
  let anchorTimezone = tracking.value?.timezone ?? null;
  if (!anchorTimezone && entry.occurredAt) {
    const existing = await periods.list(actor, 1);
    if (!existing.ok) {
      return failureFor(
        existing.error.code,
        "Unable to check Money periods right now.",
      );
    }
    anchorTimezone = existing.value[0]?.timezone ?? null;
  }
  const instant = entry.occurredAt ? new Date(entry.occurredAt) : null;
  const bookingDate =
    instant && anchorTimezone
      ? getLocalDateInTimezone(instant, anchorTimezone)
      : (entry.bookingDate ?? null);

  // The tracking period owns the current day in its own timezone. This fast
  // path keeps an ordinary timestamped write on its existing read count.
  if (
    instant &&
    tracking.value &&
    bookingDate !== null &&
    bookingDate >= tracking.value.startDate &&
    bookingDate <= tracking.value.endDate
  ) {
    return resolveRoutineEntry(
      actor,
      periods,
      bookingDate,
      tracking.value,
      now,
    );
  }

  if (instant) {
    // A retained superseded period may use a different timezone from the
    // tracking period. The target period owns the calendar for its own dates,
    // so look for exactly the period whose own local day contains the instant
    // instead of deriving the day in the tracking timezone. UTC dates shift by
    // at most one day under every IANA offset, so the ±1-day window covers all
    // candidates without scanning the whole history.
    const utcDate = getLocalDateInTimezone(instant, "UTC");
    const nearby = await periods.findOverlapping(actor, {
      startDate: addDaysToIsoDate(utcDate, -1),
      endDate: addDaysToIsoDate(utcDate, 1),
    });
    if (!nearby.ok) {
      return failureFor(
        nearby.error.code,
        "Unable to check Money periods right now.",
      );
    }
    const matches = nearby.value
      .filter(
        (period) =>
          period.lifecycle === "tracking" ||
          period.lifecycle === "superseded",
      )
      .map((period) => ({
        period,
        date: getLocalDateInTimezone(instant, period.timezone),
      }))
      .filter(
        ({ period, date }) =>
          date >= period.startDate && date <= period.endDate,
      )
      .sort((left, right) =>
        right.period.startDate.localeCompare(left.period.startDate),
      );
    // An instant can straddle two different period calendars at a timezone
    // boundary. The current tracking period is the active target; otherwise
    // the latest retained period is the deterministic choice.
    const target =
      matches.find(({ period }) => period.lifecycle === "tracking") ??
      matches[0];
    if (target) {
      const resolved = await resolveRoutineEntry(
        actor,
        periods,
        target.date,
        tracking.value,
        now,
      );
      if (!resolved.ok) return resolved;
      if (resolved.data?.periodId !== target.period.id) {
        return applicationFailure(
          "The supplied occurrence time does not fall inside that Money period's day. Send the wall time with the period's UTC offset or record the day explicitly.",
          "validation",
        );
      }
      return resolved;
    }
  }

  // No target period's own calendar contains the instant (or the entry is
  // date-only). The normal guard supplies the continuation or actionable
  // historical-path result. The database re-derives the day in the final
  // period timezone under the owner lock, so a stale target cannot land in a
  // finalized period.
  return resolveRoutineEntry(
    actor,
    periods,
    bookingDate,
    tracking.value,
    now,
  );
}

export async function createExpense(
  actor: AuthenticatedActor,
  repository: ExpenseRepository,
  input: unknown,
  options: CreateExpenseOptions = {},
): Promise<ApplicationResult<CreateExpenseOutcome>> {
  const parsed = parseCreateExpenseInput(input);
  if (!parsed.ok) {
    return applicationFailure(parsed.message, "validation");
  }
  const values = parsed.value;
  const createFingerprint = expenseReceiptFingerprint(values);

  const existing = await repository.findByIdempotencyKey(
    actor,
    values.idempotencyKey,
  );
  if (!existing.ok) {
    return failureFor(existing.error.code, "Unable to save the expense right now.");
  }
  if (existing.value) return replayOutcome(existing.value, createFingerprint);

  let periodId: string | null = null;
  let periodBookingDate = values.bookingDate;
  let requiresContinuation = false;
  if (options.periods) {
    const guard = await routineEntryGuard(
      actor,
      options.periods,
      { occurredAt: values.occurredAt, bookingDate: values.bookingDate },
      options.now,
    );
    if (!guard.ok) return guard;
    periodId = guard.data?.periodId ?? null;
    periodBookingDate = guard.data?.bookingDate ?? values.bookingDate;
    // The database continues the calendar and inserts this row atomically.
    requiresContinuation = guard.data?.requiresContinuation ?? false;
  }

  const created = await repository.create(actor, {
    values,
    createFingerprint,
    periodId,
    periodBookingDate,
    requiresContinuation,
    // The legacy expense form has no purpose field; the category is the only
    // financial meaning it carries. The canonical rule then excludes fixed
    // categories and includes ordinary discretionary spending.
    countsInDaily: defaultCountsInDaily("expense", null, values.category),
  });
  if (created.ok) {
    return applicationSuccess({ expense: created.value, replayed: false });
  }

  // A concurrent submit can win the unique constraint after our pre-check.
  // Read the winning row and classify it as a replay or a conflicting payload.
  if (created.error.code === "conflict") {
    const raced = await repository.findByIdempotencyKey(
      actor,
      values.idempotencyKey,
    );
    if (raced.ok) {
      if (raced.value) return replayOutcome(raced.value, createFingerprint);
      return applicationFailure(IDEMPOTENCY_CONFLICT, "conflict");
    }
    return failureFor(raced.error.code, "Unable to save the expense right now.");
  }

  return failureFor(created.error.code, "Unable to save the expense right now.");
}

export async function getExpense(
  actor: AuthenticatedActor,
  repository: ExpenseRepository,
  id: unknown,
): Promise<ApplicationResult<PersonalExpense>> {
  const validId = validateId(id);
  if (!validId) return applicationFailure(NOT_FOUND, "notFound");

  const result = await repository.get(actor, validId);
  if (!result.ok) {
    return failureFor(result.error.code, "Unable to load the expense right now.");
  }
  if (!result.value) return applicationFailure(NOT_FOUND, "notFound");
  return applicationSuccess(result.value);
}

export async function listExpenses(
  actor: AuthenticatedActor,
  repository: ExpenseRepository,
  input: unknown,
  options: Readonly<{ timezone?: string | null }> = {},
): Promise<ApplicationResult<ExpenseListOutcome>> {
  const parsed = parseExpenseListQuery(input, options);
  if (!parsed.ok) {
    return applicationFailure(parsed.message, "validation");
  }
  const query: ExpenseListValues = parsed.value;

  // Fetch one extra row so `hasMore` is exact without a second count query.
  const result = await repository.list(actor, {
    limit: query.limit + 1,
    offset: query.offset,
    startUtcIso: query.startUtcIso,
    endUtcExclusiveIso: query.endUtcExclusiveIso,
    startBookingDate: query.startBookingDate,
    endBookingDateExclusive: query.endBookingDateExclusive,
  });
  if (!result.ok) {
    return failureFor(result.error.code, "Unable to load expenses right now.");
  }

  const hasMore = result.value.length > query.limit;
  return applicationSuccess({
    expenses: hasMore ? result.value.slice(0, query.limit) : result.value,
    pagination: {
      limit: query.limit,
      offset: query.offset,
      hasMore,
      nextOffset: hasMore ? query.offset + query.limit : null,
    },
  });
}

export async function updateExpense(
  actor: AuthenticatedActor,
  repository: ExpenseRepository,
  id: unknown,
  input: unknown,
  options: Readonly<{ now?: Date; periods?: CreateExpenseOptions["periods"] }> = {},
): Promise<ApplicationResult<PersonalExpense>> {
  const validId = validateId(id);
  if (!validId) return applicationFailure(NOT_FOUND, "notFound");

  const parsed = parseUpdateExpenseInput(input);
  if (!parsed.ok) {
    return applicationFailure(parsed.message, "validation");
  }

  const { expectedVersion, ...changes } = parsed.value;
  const now = options.now ?? new Date();

  // Moving a purchase to another day must obey the same tracking-period gate
  // as creating it, whether the caller supplies an instant or a date-only
  // booking day. Historical expenses keep their date; amount/classification
  // edits do not enter this branch.
  if (
    options.periods
    && (changes.occurredAt !== undefined || changes.bookingDate !== undefined)
  ) {
    const current = await repository.get(actor, validId);
    if (!current.ok) {
      return failureFor(
        current.error.code,
        "Unable to load the expense right now.",
      );
    }
    if (!current.value) return applicationFailure(NOT_FOUND, "notFound");
    const existing = current.value;

    const tracking = await options.periods.findTracking(actor);
    if (!tracking.ok) {
      return failureFor(
        tracking.error.code,
        "Unable to check the tracking period right now.",
      );
    }

    let timezone: string = tracking.value?.timezone ?? MONEY_DEFAULT_TIMEZONE;
    if (existing.periodId !== null && options.periods.findById) {
      const period = await options.periods.findById(actor, existing.periodId);
      if (period.ok && period.value) timezone = period.value.timezone;
    }

    let effectiveDate = changes.bookingDate ?? null;
    if (changes.occurredAt) {
      const derived = getLocalDateInTimezone(
        new Date(changes.occurredAt),
        timezone,
      );
      if (changes.bookingDate !== undefined && changes.bookingDate !== derived) {
        return applicationFailure(
          "Booking date must match the supplied occurrence time.",
          "validation",
        );
      }
      effectiveDate = derived;
    }

    if (effectiveDate !== null && effectiveDate !== existing.bookingDate) {
      if (
        !moneyBookingDateEditable({
          periodId: existing.periodId,
          bookingDate: existing.bookingDate,
          trackingPeriod: tracking.value
            ? {
                id: tracking.value.id,
                startDate: tracking.value.startDate,
                endDate: tracking.value.endDate,
              }
            : null,
        })
      ) {
        return applicationFailure(
          "Historical period expenses keep their original booking date. Record an explicit adjustment instead of moving the date.",
          "validation",
        );
      }

      const guard = await routineEntryGuard(
        actor,
        options.periods,
        { bookingDate: effectiveDate },
        now,
      );
      if (!guard.ok) return guard;
      // A date move never advances the calendar and never leaves `period_id`
      // pointing at a different period than the new booking date. Cross-period
      // moves are explicit corrections; the row keeps its original period.
      const targetPeriodId = guard.data?.periodId ?? null;
      const staysInOwnPeriod =
        existing.periodId !== null
          ? targetPeriodId === existing.periodId
          : tracking.value
            ? targetPeriodId === tracking.value.id
            : targetPeriodId === null;
      if (guard.data?.requiresContinuation || !staysInOwnPeriod) {
        return applicationFailure(
          "Moving this expense outside its current period is an explicit correction. Record an adjustment instead of moving the date.",
          "validation",
        );
      }
    }
  }

  return fromRepository(
    await repository.update(actor, validId, {
      changes,
      expectedVersion,
      updatedAt: now.toISOString(),
    }),
    "Unable to save the expense right now.",
  );
}

export async function deleteExpense(
  actor: AuthenticatedActor,
  repository: ExpenseRepository,
  id: unknown,
  options: Readonly<{ now?: Date; expectedVersion?: number }> = {},
): Promise<
  ApplicationResult<Readonly<{
    id: string;
    deletedAt: string;
    alreadyDeleted: boolean;
  }>>
> {
  const validId = validateId(id);
  if (!validId) return applicationFailure(NOT_FOUND, "notFound");

  if (
    options.expectedVersion !== undefined
    && (!Number.isInteger(options.expectedVersion) || options.expectedVersion < 1)
  ) {
    return applicationFailure(
      "A positive expected version is required.",
      "validation",
    );
  }

  const now = options.now ?? new Date();
  const result = await repository.softDelete(
    actor,
    validId,
    now.toISOString(),
    options.expectedVersion,
  );
  if (!result.ok) {
    return failureFor(result.error.code, "Unable to delete the expense right now.");
  }
  return applicationSuccess(result.value);
}
