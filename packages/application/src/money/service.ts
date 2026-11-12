import { getLocalDateInTimezone } from "@ega/domain/time-context";
import {
  canonicalMovementCreatePayload,
  isMoneyDirection,
  parseCreateMovementInput,
  parseMoneyListQuery,
  parseMoneyStateQuery,
  parseUpdateMovementInput,
  type MoneyCreateValues,
  type MoneyLedgerRow,
  type MoneyUpdateChanges,
} from "@ega/domain/money";

import type { AuthenticatedActor } from "../auth/actor";
import { sha256Hex } from "../shared/hash";
import {
  applicationFailure,
  applicationSuccess,
  type ApplicationErrorCode,
  type ApplicationResult,
  type RepositoryFailure,
  type RepositoryResult,
} from "../shared/result";
import { assertRoutineEntryAllowed } from "./periods";
import type {
  MoneyIdempotencyReceipt,
  MoneyMovementRepository,
  MoneyPeriodRepository,
} from "./ports";
import {
  computeMoneyMovementTotals,
  type MoneyMovementTotals,
} from "./summary";

/**
 * MONEY-04 movement use cases shared by HTTP, web actions and MCP.
 *
 * Owner identity always comes from the verified actor. Parsing, the stable
 * idempotency fingerprint, optimistic concurrency and the shared routine-entry
 * period guard live here so every surface behaves identically. Opening cash
 * remains owned by MONEY-03's period initialization: the public create path
 * rejects `opening`.
 */

export type CreateMovementOutcome = Readonly<{
  movement: MoneyLedgerRow;
  replayed: boolean;
}>;

export type MovementListOutcome = Readonly<{
  movements: MoneyLedgerRow[];
  pagination: Readonly<{ limit: number; offset: number; hasMore: boolean }>;
  cutoff: string;
  timezone: string | null;
}>;

export type MovementTotalsOutcome = Readonly<{
  totals: MoneyMovementTotals;
  cutoff: string;
}>;

/**
 * The canonical MONEY-03 period guard, required for movement writes so an
 * ended/rolled-over or out-of-range booking day is answered instead of being
 * silently moved.
 */
export type MovementWriteOptions = Readonly<{
  periods: Pick<MoneyPeriodRepository, "findTracking" | "list">;
}>;

export function movementReceiptFingerprint(values: MoneyCreateValues): string {
  return sha256Hex(canonicalMovementCreatePayload(values));
}

const IDEMPOTENCY_CONFLICT =
  "That idempotency key was already used for a different movement.";
const NOT_FOUND = "Movement was not found or is no longer available.";

function failureFor(
  code: RepositoryFailure["code"] | undefined,
  fallback: string,
): ApplicationResult<never> {
  if (!code || code === "unknown") return applicationFailure(fallback);
  return applicationFailure(
    code === "notFound"
      ? NOT_FOUND
      : code === "conflict"
        ? "The movement changed. Refresh and try again."
        : "You do not have permission to change this movement.",
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

function replayOutcome(
  existing: MoneyIdempotencyReceipt,
  createFingerprint: string,
): ApplicationResult<CreateMovementOutcome> {
  if (existing.createFingerprint !== createFingerprint) {
    return applicationFailure(IDEMPOTENCY_CONFLICT, "conflict");
  }
  return applicationSuccess({ movement: existing.movement, replayed: true });
}

function validateId(id: unknown): string | null {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim())
    ? id.trim()
    : null;
}

export async function createMovement(
  actor: AuthenticatedActor,
  repository: MoneyMovementRepository,
  input: unknown,
  options: MovementWriteOptions,
): Promise<ApplicationResult<CreateMovementOutcome>> {
  const parsed = parseCreateMovementInput(input);
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");
  const values = parsed.value;

  const createFingerprint = movementReceiptFingerprint(values);
  const existing = await repository.findByIdempotencyKey(actor, values.idempotencyKey);
  if (!existing.ok) {
    return failureFor(existing.error.code, "Unable to save the movement right now.");
  }
  if (existing.value) return replayOutcome(existing.value, createFingerprint);

  const period = await assertRoutineEntryAllowed(
    actor,
    options.periods,
    values.bookingDate,
  );
  if (!period.ok) {
    return applicationFailure(period.errorMessage, period.code);
  }

  const created = await repository.create(actor, {
    values,
    createFingerprint,
    periodId: period.data?.id ?? null,
  });
  if (created.ok) {
    return applicationSuccess({ movement: created.value, replayed: false });
  }

  if (created.error.code === "conflict") {
    const raced = await repository.findByIdempotencyKey(actor, values.idempotencyKey);
    if (raced.ok) {
      if (raced.value) return replayOutcome(raced.value, createFingerprint);
      return applicationFailure(IDEMPOTENCY_CONFLICT, "conflict");
    }
    return failureFor(raced.error.code, "Unable to save the movement right now.");
  }

  return failureFor(created.error.code, "Unable to save the movement right now.");
}

export async function getMovement(
  actor: AuthenticatedActor,
  repository: MoneyMovementRepository,
  id: unknown,
): Promise<ApplicationResult<MoneyLedgerRow>> {
  const validId = validateId(id);
  if (!validId) return applicationFailure(NOT_FOUND, "notFound");
  const result = await repository.get(actor, validId);
  if (!result.ok) {
    return failureFor(result.error.code, "Unable to load the movement right now.");
  }
  if (!result.value) return applicationFailure(NOT_FOUND, "notFound");
  return applicationSuccess(result.value);
}

export async function listMovements(
  actor: AuthenticatedActor,
  repository: MoneyMovementRepository,
  input: unknown,
  options: Readonly<{ timezone?: string | null; now?: Date }> = {},
): Promise<ApplicationResult<MovementListOutcome>> {
  const parsed = parseMoneyListQuery(input, { timezone: options.timezone });
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");
  const query = parsed.value;

  const result = await repository.list(actor, {
    limit: query.limit + 1,
    offset: query.offset,
    from: query.from,
    to: query.to,
    cutoff: query.cutoff,
    kind: query.kind,
  });
  if (!result.ok) {
    return failureFor(result.error.code, "Unable to load movements right now.");
  }

  const hasMore = result.value.length > query.limit;
  const cutoff =
    query.cutoff ??
    query.to ??
    getLocalDateInTimezone(
      options.now ?? new Date(),
      query.timezone ?? options.timezone ?? "UTC",
    );

  return applicationSuccess({
    movements: hasMore ? result.value.slice(0, query.limit) : result.value,
    pagination: { limit: query.limit, offset: query.offset, hasMore },
    cutoff,
    timezone: query.timezone ?? options.timezone ?? null,
  });
}

function validateChangesForKind(
  kind: MoneyLedgerRow["kind"],
  changes: MoneyUpdateChanges,
): string | null {
  if (kind !== "expense") {
    if (changes.category !== undefined) {
      return "Only expense movements have a spending category.";
    }
    if (changes.needVsWant !== undefined) {
      return "Only expense movements have a need or want classification.";
    }
    if (changes.purpose !== undefined && changes.purpose !== null) {
      return "Only expense movements have a spending purpose.";
    }
  }
  return null;
}

export async function updateMovement(
  actor: AuthenticatedActor,
  repository: MoneyMovementRepository,
  id: unknown,
  input: unknown,
  options: MovementWriteOptions & Readonly<{ now?: Date }>,
): Promise<ApplicationResult<MoneyLedgerRow>> {
  const validId = validateId(id);
  if (!validId) return applicationFailure(NOT_FOUND, "notFound");

  const parsed = parseUpdateMovementInput(input);
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");
  const { expectedVersion, ...changes } = parsed.value;

  const current = await repository.get(actor, validId);
  if (!current.ok) {
    return failureFor(current.error.code, "Unable to load the movement right now.");
  }
  if (!current.value) return applicationFailure(NOT_FOUND, "notFound");
  const movement = current.value;

  // Opening cash has one owner: the period/settings correction path, which
  // keeps version, provenance and evidence coherent. A generic ledger update
  // must never become a second opening writer.
  if (movement.kind === "opening") {
    return applicationFailure(
      "Opening cash is corrected through Money period settings, not the movement ledger.",
      "validation",
    );
  }

  const kindError = validateChangesForKind(movement.kind, changes);
  if (kindError) return applicationFailure(kindError, "validation");

  // Moving a movement to another day must obey the same tracking-period gate
  // as creating it. A timestamp-only change is re-derived in the tracking
  // timezone so the DB trigger cannot quietly move the booking day.
  let bookingDate = changes.bookingDate;
  if (!bookingDate && changes.occurredAt) {
    const tracking = await options.periods.findTracking(actor);
    if (!tracking.ok) {
      return failureFor(
        tracking.error.code,
        "Unable to check the tracking period right now.",
      );
    }
    bookingDate = getLocalDateInTimezone(
      new Date(changes.occurredAt),
      tracking.value?.timezone ?? "UTC",
    );
  }
  if (bookingDate !== undefined) {
    const guard = await assertRoutineEntryAllowed(
      actor,
      options.periods,
      bookingDate,
    );
    if (!guard.ok) {
      return applicationFailure(guard.errorMessage, guard.code);
    }
  }

  const now = options.now ?? new Date();
  return fromRepository(
    await repository.update(actor, validId, {
      changes,
      expectedVersion,
      updatedAt: now.toISOString(),
    }),
    "Unable to save the movement right now.",
  );
}

/**
 * Movement reporting projection through an explicit cutoff. Cash itself is
 * MONEY-03's canonical `getMoneyCashPosition`; this function only adds the
 * disjoint expense/daily/savings projections so the two never disagree.
 */
export async function getMoneyMovementTotals(
  actor: AuthenticatedActor,
  repository: MoneyMovementRepository,
  input: unknown,
  options: Readonly<{
    cutoff: string;
    startDate?: string | null;
    timezone?: string | null;
  }>,
): Promise<ApplicationResult<MovementTotalsOutcome>> {
  const parsed = parseMoneyStateQuery(input, { timezone: options.timezone });
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");
  const cutoff = parsed.value.cutoff ?? options.cutoff;

  const aggregate = await repository.aggregate(actor, {
    cutoff,
    startDate: options.startDate ?? null,
  });
  if (!aggregate.ok) {
    return failureFor(aggregate.error.code, "Unable to calculate money totals right now.");
  }

  return applicationSuccess({
    totals: computeMoneyMovementTotals(aggregate.value),
    cutoff,
  });
}

/** Guard used by the transport to reject a caller-selected direction. */
export function isSupportedMovementDirection(value: unknown): boolean {
  return isMoneyDirection(value);
}
