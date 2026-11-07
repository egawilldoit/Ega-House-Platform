import {
  expenseMatchesCreateValues,
  isExpenseId,
  parseCreateExpenseInput,
  parseExpenseListQuery,
  parseUpdateExpenseInput,
  type ExpenseCreateValues,
  type ExpenseListValues,
  type PersonalExpense,
} from "@ega/domain/expenses";

import type { AuthenticatedActor } from "../auth/actor";
import {
  applicationFailure,
  applicationSuccess,
  type ApplicationErrorCode,
  type ApplicationResult,
  type RepositoryFailure,
  type RepositoryResult,
} from "../shared/result";
import type { ExpenseRepository } from "./ports";

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
  pagination: Readonly<{ limit: number; offset: number; hasMore: boolean }>;
}>;

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
  existing: PersonalExpense,
  values: ExpenseCreateValues,
): ApplicationResult<CreateExpenseOutcome> {
  if (!expenseMatchesCreateValues(existing, values)) {
    return applicationFailure(IDEMPOTENCY_CONFLICT, "conflict");
  }
  return applicationSuccess({ expense: existing, replayed: true });
}

export async function createExpense(
  actor: AuthenticatedActor,
  repository: ExpenseRepository,
  input: unknown,
): Promise<ApplicationResult<CreateExpenseOutcome>> {
  const parsed = parseCreateExpenseInput(input);
  if (!parsed.ok) {
    return applicationFailure(parsed.message, "validation");
  }
  const values = parsed.value;

  const existing = await repository.findByIdempotencyKey(
    actor,
    values.idempotencyKey,
  );
  if (!existing.ok) {
    return failureFor(existing.error.code, "Unable to save the expense right now.");
  }
  if (existing.value) return replayOutcome(existing.value, values);

  const created = await repository.create(actor, values);
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
      if (raced.value) return replayOutcome(raced.value, values);
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
    },
  });
}

export async function updateExpense(
  actor: AuthenticatedActor,
  repository: ExpenseRepository,
  id: unknown,
  input: unknown,
  options: Readonly<{ now?: Date }> = {},
): Promise<ApplicationResult<PersonalExpense>> {
  const validId = validateId(id);
  if (!validId) return applicationFailure(NOT_FOUND, "notFound");

  const parsed = parseUpdateExpenseInput(input);
  if (!parsed.ok) {
    return applicationFailure(parsed.message, "validation");
  }

  const { expectedVersion, ...changes } = parsed.value;
  const now = options.now ?? new Date();

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
  options: Readonly<{ now?: Date }> = {},
): Promise<
  ApplicationResult<Readonly<{
    id: string;
    deletedAt: string;
    alreadyDeleted: boolean;
  }>>
> {
  const validId = validateId(id);
  if (!validId) return applicationFailure(NOT_FOUND, "notFound");

  const now = options.now ?? new Date();
  const result = await repository.softDelete(
    actor,
    validId,
    now.toISOString(),
  );
  if (!result.ok) {
    return failureFor(result.error.code, "Unable to delete the expense right now.");
  }
  return applicationSuccess(result.value);
}
