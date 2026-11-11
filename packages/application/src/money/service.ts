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
import type {
  MoneyIdempotencyReceipt,
  MoneyPeriodRead,
  MoneyRepository,
} from "./ports";
import {
  computeMoneyState,
  todayForState,
  type MoneyState,
} from "./summary";

/**
 * MONEY-04 movement use cases shared by HTTP, web actions and MCP.
 *
 * Owner identity always comes from the verified actor. Parsing, the stable
 * idempotency fingerprint, optimistic concurrency and period-window checks
 * live here so every surface behaves identically. Opening cash remains owned by
 * MONEY-03's period initialization: the public create path rejects `opening`.
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

export type MoneyStateOutcome = Readonly<{
  state: MoneyState;
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

type PeriodGate =
  | { ok: true; periodId: string | null }
  | { ok: false; message: string };

function gateForWrite(
  periodRead: MoneyPeriodRead,
  bookingDate: string,
): PeriodGate {
  if (!periodRead.available) {
    // MONEY-03 is not applied in this deployment yet. Record the movement
    // against the ledger without fabricating period context.
    return { ok: true, periodId: null };
  }
  const period = periodRead.period;
  if (!period) return { ok: true, periodId: null };
  if (period.lifecycle !== "tracking") {
    return {
      ok: false,
      message:
        "This period is not tracking. Start or roll over a period before recording routine movements.",
    };
  }
  if (bookingDate < period.startDate || bookingDate > period.endDate) {
    return {
      ok: false,
      message: `That booking date is outside the tracking period (${period.startDate} to ${period.endDate}). Select the correct period instead of moving the date silently.`,
    };
  }
  return { ok: true, periodId: period.id };
}

export async function createMovement(
  actor: AuthenticatedActor,
  repository: MoneyRepository,
  input: unknown,
): Promise<ApplicationResult<CreateMovementOutcome>> {
  const parsed = parseCreateMovementInput(input);
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");
  const values = parsed.value;

  const periodRead = await repository.getPeriod(actor);
  if (!periodRead.ok) {
    return failureFor(periodRead.error.code, "Unable to check the money period right now.");
  }
  const gate = gateForWrite(periodRead.value, values.bookingDate);
  if (!gate.ok) return applicationFailure(gate.message, "validation");

  const createFingerprint = movementReceiptFingerprint(values);
  const existing = await repository.findByIdempotencyKey(actor, values.idempotencyKey);
  if (!existing.ok) {
    return failureFor(existing.error.code, "Unable to save the movement right now.");
  }
  if (existing.value) return replayOutcome(existing.value, createFingerprint);

  const created = await repository.create(actor, {
    values,
    createFingerprint,
    periodId: gate.periodId,
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
  repository: MoneyRepository,
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
  repository: MoneyRepository,
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
    todayForState({ now: options.now, timezone: query.timezone ?? options.timezone ?? null });

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
  repository: MoneyRepository,
  id: unknown,
  input: unknown,
  options: Readonly<{ now?: Date }> = {},
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

  const kindError = validateChangesForKind(movement.kind, changes);
  if (kindError) return applicationFailure(kindError, "validation");

  if (changes.bookingDate !== undefined) {
    const periodRead = await repository.getPeriod(actor);
    if (!periodRead.ok) {
      return failureFor(periodRead.error.code, "Unable to check the money period right now.");
    }
    const period = periodRead.value.period;
    if (
      periodRead.value.available &&
      period !== null &&
      (changes.bookingDate < period.startDate || changes.bookingDate > period.endDate)
    ) {
      return applicationFailure(
        `That booking date is outside the tracking period (${period.startDate} to ${period.endDate}).`,
        "validation",
      );
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

export async function getMoneyState(
  actor: AuthenticatedActor,
  repository: MoneyRepository,
  input: unknown,
  options: Readonly<{ timezone?: string | null; now?: Date }> = {},
): Promise<ApplicationResult<MoneyStateOutcome>> {
  const parsed = parseMoneyStateQuery(input, { timezone: options.timezone });
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");
  const query = parsed.value;

  const periodRead = await repository.getPeriod(actor);
  if (!periodRead.ok) {
    return failureFor(periodRead.error.code, "Unable to load the money period right now.");
  }
  const period = periodRead.value.period;
  const timezone = query.timezone ?? options.timezone ?? period?.timezone ?? null;
  const fallbackCutoff = period?.activeDate
    ?? todayForState({ now: options.now, timezone });
  let cutoff = query.cutoff ?? fallbackCutoff;
  // A period-scoped read never counts later periods' movements as this
  // period's cash. The reported cutoff is the effective one.
  if (period && cutoff > period.endDate) cutoff = period.endDate;

  const aggregate = await repository.aggregate(actor, {
    cutoff,
    startDate: period?.startDate ?? null,
  });
  if (!aggregate.ok) {
    return failureFor(aggregate.error.code, "Unable to calculate recorded cash right now.");
  }

  return applicationSuccess({
    state: computeMoneyState(aggregate.value, {
      cutoff,
      timezone,
      period: periodRead.value,
      now: options.now,
    }),
  });
}

/** Guard used by the transport to reject a caller-selected direction. */
export function isSupportedMovementDirection(value: unknown): boolean {
  return isMoneyDirection(value);
}
