import {
  isObligationId,
  parseObligationPaymentCorrectionInput,
  parseObligationPaymentInput,
  parseObligationUndoInput,
  resolveObligationPaymentCountsInDaily,
  validateObligationPayment,
  type ObligationOccurrence,
} from "@ega/domain/obligations";

import type { AuthenticatedActor } from "../auth/actor";
import {
  applicationFailure,
  applicationSuccess,
  type ApplicationErrorCode,
  type ApplicationResult,
  type RepositoryFailure,
} from "../shared/result";
import type { ObligationRepository } from "./obligation-ports";
import type {
  ObligationPaymentOutcome,
  ObligationPaymentRepository,
} from "./obligation-payment-ports";

/**
 * MONEY-07 obligation payment use cases.
 *
 * One obligation, one canonical ledger: a payment inserts exactly one
 * `personal_expenses` outflow and links the occurrence in the same database
 * transaction. A correction moves that linked payment and the occurrence
 * together, and an undo removes the payment and reopens the occurrence
 * together. The application validates the request, resolves the classification
 * and phrases the outcome; the database owns the atomic write, the owner
 * identity and the optimistic concurrency.
 *
 * The operation id is the retry identity of one write. It is carried beside
 * the payload — never inside the strictly parsed body — so the same operation
 * replays its original result while a different operation cannot pay an
 * already-paid occurrence.
 */

const NOT_FOUND = "Obligation was not found or is no longer available.";

export type ObligationPaymentDependencies = Readonly<{
  obligations: ObligationRepository;
  payments: ObligationPaymentRepository;
}>;

export type ObligationPaymentOptions = Readonly<{ operationId: string }>;

function failureFor(
  code: RepositoryFailure["code"] | undefined,
  fallback: string,
): ApplicationResult<never> {
  if (!code || code === "unknown") return applicationFailure(fallback);
  return applicationFailure(
    code === "notFound"
      ? NOT_FOUND
      : code === "conflict"
        ? "The obligation changed. Refresh and try again."
        : code === "validation"
          ? "That payment request was refused."
          : "You do not have permission to change this obligation.",
    code as ApplicationErrorCode,
  );
}

function validateId(id: unknown): string | null {
  return typeof id === "string" && isObligationId(id.trim()) ? id.trim() : null;
}

function validateOperationId(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 128) return null;
  return trimmed;
}

async function loadOccurrence(
  actor: AuthenticatedActor,
  dependencies: ObligationPaymentDependencies,
  id: string,
): Promise<ApplicationResult<ObligationOccurrence>> {
  const current = await dependencies.obligations.get(actor, id);
  if (!current.ok) {
    return failureFor(
      current.error.code,
      "Unable to load the obligation right now.",
    );
  }
  if (!current.value) return applicationFailure(NOT_FOUND, "notFound");
  return applicationSuccess(current.value);
}

/**
 * Record one payment for a pending obligation.
 *
 * The occurrence is read first only to phrase the outcome and to resolve the
 * classification; the database re-checks the version, the state and the full
 * amount inside the transaction, so a stale or concurrent request cannot pay.
 */
export async function payObligation(
  actor: AuthenticatedActor,
  dependencies: ObligationPaymentDependencies,
  id: unknown,
  input: unknown,
  options: ObligationPaymentOptions,
): Promise<ApplicationResult<ObligationPaymentOutcome>> {
  const validId = validateId(id);
  if (!validId) return applicationFailure(NOT_FOUND, "notFound");

  const parsed = parseObligationPaymentInput(input);
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");

  const operationId = validateOperationId(options?.operationId);
  if (!operationId) {
    return applicationFailure("A payment needs an operation id.", "validation");
  }

  const loaded = await loadOccurrence(actor, dependencies, validId);
  if (!loaded.ok) return loaded;
  const occurrence = loaded.data;

  if (occurrence.state !== "pending" && occurrence.state !== "paid") {
    return applicationFailure(
      "Reopen the obligation to pending before paying it.",
      "conflict",
    );
  }

  // Need/want is requested, never fabricated: the payment input wins, then the
  // occurrence snapshot, and an unknown value is refused.
  const needVsWant =
    parsed.value.needVsWant !== undefined
      ? parsed.value.needVsWant
      : occurrence.needVsWant;

  if (occurrence.state === "pending") {
    if (!needVsWant) {
      return applicationFailure(
        "Choose need or want before paying this obligation.",
        "validation",
        "need_vs_want_required",
      );
    }

    // The MONEY-06 seam rule, applied before anything is linked: one full
    // payment, in MAD, as an outflow, on a real booking date.
    const seam = validateObligationPayment(occurrence, {
      expenseId: occurrence.id,
      amountMinor: occurrence.amountMinor,
      currency: occurrence.currency,
      direction: "out",
      bookingDate: parsed.value.bookingDate,
    });
    if (!seam.ok) {
      return applicationFailure(
        seam.message,
        seam.reason === "invalid_booking_date" ? "validation" : "conflict",
      );
    }

    if (occurrence.version !== parsed.value.version) {
      return applicationFailure(
        "The obligation changed. Refresh and try again.",
        "conflict",
      );
    }
  }

  const countsInDaily = resolveObligationPaymentCountsInDaily({
    purpose: occurrence.purpose,
    occurrenceCountsInDaily: occurrence.countsInDaily,
    explicit: parsed.value.countsInDaily,
  });

  const result = await dependencies.payments.pay(actor, {
    occurrenceId: validId,
    expectedVersion: parsed.value.version,
    bookingDate: parsed.value.bookingDate,
    idempotencyKey: parsed.value.idempotencyKey,
    needVsWant: needVsWant ?? null,
    countsInDaily,
    paymentMethod: parsed.value.paymentMethod ?? null,
    operationId,
  });
  if (!result.ok) {
    if (result.error.code === "conflict" && occurrence.state === "paid") {
      return applicationFailure("This obligation is already paid.", "conflict");
    }
    return failureFor(
      result.error.code,
      "Unable to record the payment right now.",
    );
  }
  return applicationSuccess(result.value);
}

/**
 * Correct a linked payment: the amount, the booking date and the daily flag
 * move together with the occurrence, so the pair stays coherent.
 */
export async function correctObligationPayment(
  actor: AuthenticatedActor,
  dependencies: ObligationPaymentDependencies,
  id: unknown,
  input: unknown,
  options: ObligationPaymentOptions,
): Promise<ApplicationResult<ObligationPaymentOutcome>> {
  const validId = validateId(id);
  if (!validId) return applicationFailure(NOT_FOUND, "notFound");

  const parsed = parseObligationPaymentCorrectionInput(input);
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");

  const operationId = validateOperationId(options?.operationId);
  if (!operationId) {
    return applicationFailure("A correction needs an operation id.", "validation");
  }

  const loaded = await loadOccurrence(actor, dependencies, validId);
  if (!loaded.ok) return loaded;
  const occurrence = loaded.data;

  const result = await dependencies.payments.correct(actor, {
    occurrenceId: validId,
    expectedVersion: parsed.value.version,
    amountMinor: parsed.value.amountMinor,
    bookingDate: parsed.value.bookingDate,
    countsInDaily: parsed.value.countsInDaily ?? null,
    operationId,
  });
  if (!result.ok) {
    if (result.error.code === "conflict") {
      if (occurrence.state !== "paid") {
        return applicationFailure(
          "Only a paid obligation can be corrected.",
          "conflict",
        );
      }
      if (!occurrence.paymentExpenseId) {
        return applicationFailure(
          "This paid obligation has no linked payment to correct.",
          "conflict",
        );
      }
    }
    return failureFor(
      result.error.code,
      "Unable to correct the payment right now.",
    );
  }
  return applicationSuccess(result.value);
}

/**
 * Undo a linked payment: the ledger row is soft-deleted and the occurrence
 * returns to pending in one transaction, restoring cash and the outstanding
 * reserve together.
 */
export async function undoObligationPayment(
  actor: AuthenticatedActor,
  dependencies: ObligationPaymentDependencies,
  id: unknown,
  input: unknown,
  options: ObligationPaymentOptions,
): Promise<ApplicationResult<ObligationPaymentOutcome>> {
  const validId = validateId(id);
  if (!validId) return applicationFailure(NOT_FOUND, "notFound");

  const parsed = parseObligationUndoInput(input);
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");

  const operationId = validateOperationId(options?.operationId);
  if (!operationId) {
    return applicationFailure("An undo needs an operation id.", "validation");
  }

  const loaded = await loadOccurrence(actor, dependencies, validId);
  if (!loaded.ok) return loaded;
  const occurrence = loaded.data;

  const result = await dependencies.payments.undo(actor, {
    occurrenceId: validId,
    expectedVersion: parsed.value.version,
    operationId,
  });
  if (!result.ok) {
    if (result.error.code === "conflict") {
      if (occurrence.state !== "paid") {
        return applicationFailure(
          "Only a paid obligation can be undone.",
          "conflict",
        );
      }
      if (!occurrence.paymentExpenseId) {
        return applicationFailure(
          "This paid obligation has no linked payment to undo.",
          "conflict",
        );
      }
    }
    return failureFor(result.error.code, "Unable to undo the payment right now.");
  }
  return applicationSuccess(result.value);
}
