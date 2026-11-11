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
import { getLocalDateInTimezone } from "@ega/domain/time-context";

import type { AuthenticatedActor } from "../auth/actor";
import type { MoneyPeriodRepository } from "../money/ports";
import { routineEntryGuardFailure } from "../money/periods";
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
   * Optional period guard. When supplied, a configured tracking period only
   * accepts a routine expense whose owner-local booking date falls inside its
   * inclusive range. Accounts with no period keep the existing behavior; an
   * ended/rolled-over account must use the explicit historical correction path.
   */
  periods?: Pick<MoneyPeriodRepository, "findTracking" | "list">;
}>;

/**
 * One tracking-period gate for routine writes, shared by create and by any
 * update that moves the booking instant. Ended/rolled-over periods accept
 * entries only through the explicit historical correction path.
 */
async function routineEntryGuard(
  actor: AuthenticatedActor,
  periods: NonNullable<CreateExpenseOptions["periods"]>,
  entry: Readonly<{ occurredAt?: string; bookingDate?: string }>,
): Promise<ApplicationResult<never> | null> {
  const tracking = await periods.findTracking(actor);
  if (!tracking.ok) {
    return failureFor(
      tracking.error.code,
      "Unable to check the tracking period right now.",
    );
  }
  if (tracking.value) {
    // A date-only edit supplies the booking day directly; a timestamped one is
    // resolved in the same timezone the entry guard uses.
    const bookingDate =
      entry.bookingDate ??
      (entry.occurredAt
        ? getLocalDateInTimezone(
            new Date(entry.occurredAt),
            tracking.value.timezone,
          )
        : null);
    if (bookingDate === null) return null;
    const guardMessage = routineEntryGuardFailure(tracking.value, bookingDate);
    return guardMessage ? applicationFailure(guardMessage, "validation") : null;
  }
  const existing = await periods.list(actor, 1);
  if (!existing.ok) {
    return failureFor(
      existing.error.code,
      "Unable to check Money periods right now.",
    );
  }
  if (existing.value.length > 0) {
    return applicationFailure(
      "There is no tracking period. Ended or rolled-over periods accept entries only through the explicit historical correction path.",
      "validation",
    );
  }
  return null;
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

  if (options.periods) {
    const guard = await routineEntryGuard(
      actor,
      options.periods,
      { occurredAt: values.occurredAt },
    );
    if (guard) return guard;
  }

  const created = await repository.create(actor, { values, createFingerprint });
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
  // booking day.
  if (
    options.periods
    && (changes.occurredAt !== undefined || changes.bookingDate !== undefined)
  ) {
    const guard = await routineEntryGuard(actor, options.periods, {
      occurredAt: changes.occurredAt,
      bookingDate: changes.bookingDate,
    });
    if (guard) return guard;
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
