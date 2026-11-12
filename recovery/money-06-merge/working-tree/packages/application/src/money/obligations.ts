import type {
  ExpenseCategory,
  ExpenseNeedVsWant,
} from "@ega/domain/expenses";
import type { MoneyPurpose } from "@ega/domain/money";
import {
  canonicalObligationCreatePayload,
  canonicalObligationTemplateCreatePayload,
  decideObligationTransition,
  dueDateForObligationPeriod,
  endOfObligationPeriod,
  isObligationId,
  listObligationPeriodStarts,
  missingPaymentClassification,
  parseCreateObligationInput,
  parseCreateObligationTemplateInput,
  parseObligationCutoffQuery,
  parseObligationGenerationInput,
  parseObligationListQuery,
  parseObligationTemplateListQuery,
  parseObligationTransitionInput,
  parseUpdateObligationInput,
  parseUpdateObligationTemplateInput,
  resolveObligationClassification,
  summarizeObligationOccurrences,
  templateClassificationSource,
  validateObligationPayment,
  validateObligationPeriod,
  type ObligationCreateValues,
  type ObligationListValues,
  type ObligationOccurrence,
  type ObligationTemplate,
  type ObligationTemplateCreateValues,
  type ObligationTotals,
  type ResolvedObligationClassification,
} from "@ega/domain/obligations";

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
  ObligationPaymentSettlementInput,
  ObligationRepository,
  ObligationTemplateListRecordQuery,
} from "./obligation-ports";

/**
 * MONEY-06 obligation use cases.
 *
 * The actor comes only from verified authentication. Validation, classification
 * resolution, lifecycle decisions and cutoff totals live in `@ega/domain`;
 * this layer composes them with persistence and maps infrastructure failures
 * onto the small application error vocabulary. Web and MCP compose these same
 * use cases — neither owns a second calculation.
 */

/** Upper bound for one summary; exceeding it reports a lower-bound total. */
export const OBLIGATION_SUMMARY_MAX_OCCURRENCES = 5_000;

/**
 * Deterministic receipt fingerprint for the immutable occurrence create
 * payload. Exported so transports/tests can verify a replay without
 * duplicating the canonicalization.
 */
export function obligationReceiptFingerprint(
  values: ObligationCreateValues,
): string {
  return sha256Hex(canonicalObligationCreatePayload(values));
}

/** Deterministic receipt fingerprint for the immutable template create. */
export function obligationTemplateReceiptFingerprint(
  values: ObligationTemplateCreateValues,
): string {
  return sha256Hex(canonicalObligationTemplateCreatePayload(values));
}

export type CreateObligationOutcome = Readonly<{
  occurrence: ObligationOccurrence;
  replayed: boolean;
}>;

export type ObligationListOutcome = Readonly<{
  occurrences: ObligationOccurrence[];
  pagination: Readonly<{ limit: number; offset: number; hasMore: boolean }>;
}>;

export type ObligationTemplateListOutcome = Readonly<{
  templates: ObligationTemplate[];
}>;

export type GenerateObligationsOutcome = Readonly<{
  templateId: string;
  throughDate: string;
  created: number;
  existing: number;
  occurrences: ObligationOccurrence[];
  /** True when the generation cap was reached before `throughDate`. */
  truncated: boolean;
}>;

const NOT_FOUND = "Obligation was not found or is no longer available.";
const TEMPLATE_NOT_FOUND = "Obligation template was not found.";
const IDEMPOTENCY_CONFLICT =
  "That idempotency key was already used for a different obligation.";
const TEMPLATE_IDEMPOTENCY_CONFLICT =
  "That idempotency key was already used for a different obligation template.";
const TEMPLATE_PERIOD_CONFLICT =
  "An occurrence for that template period already exists.";

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
        : "You do not have permission to change this obligation.",
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
  return typeof id === "string" && isObligationId(id.trim()) ? id.trim() : null;
}

/* -------------------------------------------------------------------------- */
/* Occurrence reads                                                           */
/* -------------------------------------------------------------------------- */

export async function getObligation(
  actor: AuthenticatedActor,
  repository: ObligationRepository,
  id: unknown,
): Promise<ApplicationResult<ObligationOccurrence>> {
  const validId = validateId(id);
  if (!validId) return applicationFailure(NOT_FOUND, "notFound");

  const result = await repository.get(actor, validId);
  if (!result.ok) {
    return failureFor(result.error.code, "Unable to load the obligation right now.");
  }
  if (!result.value) return applicationFailure(NOT_FOUND, "notFound");
  return applicationSuccess(result.value);
}

export async function listObligations(
  actor: AuthenticatedActor,
  repository: ObligationRepository,
  input: unknown,
): Promise<ApplicationResult<ObligationListOutcome>> {
  const parsed = parseObligationListQuery(input);
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");
  const query: ObligationListValues = parsed.value;

  // Fetch one extra row so `hasMore` is exact without a second count query.
  const result = await repository.list(actor, {
    kind: query.kind,
    state: query.state,
    dueFrom: query.dueFrom,
    dueTo: query.dueTo,
    limit: query.limit + 1,
    offset: query.offset,
  });
  if (!result.ok) {
    return failureFor(result.error.code, "Unable to load obligations right now.");
  }

  const hasMore = result.value.length > query.limit;
  return applicationSuccess({
    occurrences: hasMore ? result.value.slice(0, query.limit) : result.value,
    pagination: { limit: query.limit, offset: query.offset, hasMore },
  });
}

/**
 * Due/overdue/outstanding totals for complete occurrences at an inclusive
 * cutoff. A capped read is reported as `truncated`, never as a complete total.
 */
export async function getObligationSummary(
  actor: AuthenticatedActor,
  repository: ObligationRepository,
  input: unknown,
): Promise<ApplicationResult<ObligationTotals>> {
  const parsed = parseObligationCutoffQuery(input);
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");

  const result = await repository.list(actor, {
    kind: parsed.value.kind,
    state: null,
    dueFrom: null,
    dueTo: parsed.value.cutoff,
    limit: OBLIGATION_SUMMARY_MAX_OCCURRENCES + 1,
    offset: 0,
  });
  if (!result.ok) {
    return failureFor(result.error.code, "Unable to load obligation totals right now.");
  }

  const truncated = result.value.length > OBLIGATION_SUMMARY_MAX_OCCURRENCES;
  const occurrences = truncated
    ? result.value.slice(0, OBLIGATION_SUMMARY_MAX_OCCURRENCES)
    : result.value;
  return applicationSuccess(
    summarizeObligationOccurrences(occurrences, parsed.value.cutoff, {
      truncated,
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Occurrence writes                                                          */
/* -------------------------------------------------------------------------- */

export async function createObligation(
  actor: AuthenticatedActor,
  repository: ObligationRepository,
  input: unknown,
): Promise<ApplicationResult<CreateObligationOutcome>> {
  const parsed = parseCreateObligationInput(input);
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");

  let template: ObligationTemplate | null = null;
  if (parsed.value.templateId) {
    const templateResult = await repository.getTemplate(
      actor,
      parsed.value.templateId,
    );
    if (!templateResult.ok) {
      return failureFor(
        templateResult.error.code,
        "Unable to load the obligation template right now.",
      );
    }
    if (!templateResult.value) {
      return applicationFailure(TEMPLATE_NOT_FOUND, "notFound");
    }
    template = templateResult.value;
    if (template.lifecycle !== "active") {
      return applicationFailure(
        "That template is archived. Reactivate it or create the occurrence without a template.",
        "validation",
      );
    }
    if (template.kind !== parsed.value.kind) {
      return applicationFailure(
        "The template kind does not match this occurrence.",
        "validation",
      );
    }
  }

  // Template supplies defaults only; the occurrence snapshots the resolved
  // values so a later template edit cannot rewrite it.
  const classification = resolveObligationClassification({
    kind: parsed.value.kind,
    template: templateClassificationSource(template),
    occurrence: parsed.value,
  });

  const values: ObligationCreateValues = {
    kind: parsed.value.kind,
    description: parsed.value.description,
    amountMinor: parsed.value.amountMinor,
    periodStart: parsed.value.periodStart,
    periodEnd: parsed.value.periodEnd,
    dueDate: parsed.value.dueDate,
    needVsWant: classification.needVsWant,
    purpose: classification.purpose,
    countsInDaily: classification.countsInDaily,
    category: classification.category,
    stateEffectiveDate: parsed.value.stateEffectiveDate,
    templateId: parsed.value.templateId,
    idempotencyKey: parsed.value.idempotencyKey,
  };
  const createFingerprint = obligationReceiptFingerprint(values);

  const existing = await repository.findByIdempotencyKey(
    actor,
    values.idempotencyKey,
  );
  if (!existing.ok) {
    return failureFor(
      existing.error.code,
      "Unable to save the obligation right now.",
    );
  }
  if (existing.value) {
    return replayOccurrence(existing.value, createFingerprint);
  }

  const created = await repository.create(actor, { values, createFingerprint });
  if (created.ok) {
    return applicationSuccess({ occurrence: created.value, replayed: false });
  }
  if (created.error.code === "conflict") {
    const raced = await repository.findByIdempotencyKey(
      actor,
      values.idempotencyKey,
    );
    if (raced.ok) {
      if (raced.value) return replayOccurrence(raced.value, createFingerprint);
      // The conflict came from the template/period uniqueness, not the
      // idempotency receipt: the occurrence already exists under another key.
      return applicationFailure(TEMPLATE_PERIOD_CONFLICT, "conflict");
    }
    return failureFor(
      raced.error.code,
      "Unable to save the obligation right now.",
    );
  }
  return failureFor(created.error.code, "Unable to save the obligation right now.");
}

function replayOccurrence(
  existing: { occurrence: ObligationOccurrence; createFingerprint: string },
  createFingerprint: string,
): ApplicationResult<CreateObligationOutcome> {
  if (existing.createFingerprint !== createFingerprint) {
    return applicationFailure(IDEMPOTENCY_CONFLICT, "conflict");
  }
  return applicationSuccess({ occurrence: existing.occurrence, replayed: true });
}

export async function updateObligation(
  actor: AuthenticatedActor,
  repository: ObligationRepository,
  id: unknown,
  input: unknown,
  options: Readonly<{ now?: Date }> = {},
): Promise<ApplicationResult<ObligationOccurrence>> {
  const validId = validateId(id);
  if (!validId) return applicationFailure(NOT_FOUND, "notFound");

  const parsed = parseUpdateObligationInput(input);
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");
  const { expectedVersion, ...changes } = parsed.value;

  const current = await repository.get(actor, validId);
  if (!current.ok) {
    return failureFor(
      current.error.code,
      "Unable to load the obligation right now.",
    );
  }
  if (!current.value) return applicationFailure(NOT_FOUND, "notFound");
  const occurrence = current.value;

  // A paid occurrence is settled by its linked payment. Amount, schedule,
  // period and classification are owned by that payment/occurrence pair and
  // can only change through the MONEY-07 correction path.
  if (occurrence.state === "paid") {
    const touchesSettlement =
      changes.amountMinor !== undefined ||
      changes.periodStart !== undefined ||
      changes.periodEnd !== undefined ||
      changes.dueDate !== undefined ||
      changes.needVsWant !== undefined ||
      changes.purpose !== undefined ||
      changes.countsInDaily !== undefined ||
      changes.category !== undefined;
    if (touchesSettlement) {
      return applicationFailure(
        "This obligation is paid. Correct the linked payment through the MONEY-07 path; only its description can be edited here.",
        "conflict",
      );
    }
  }

  const periodStart = changes.periodStart ?? occurrence.periodStart;
  const periodEnd = changes.periodEnd ?? occurrence.periodEnd;
  const dueDate = changes.dueDate ?? occurrence.dueDate;
  const periodFailure = validateObligationPeriod(periodStart, periodEnd, dueDate);
  if (periodFailure) {
    return applicationFailure(periodFailure.message, "validation");
  }

  const now = options.now ?? new Date();
  return fromRepository(
    await repository.update(actor, validId, {
      changes,
      expectedVersion,
      updatedAt: now.toISOString(),
    }),
    "Unable to save the obligation right now.",
  );
}

/**
 * Explicit lifecycle transition (cancel/waive/reopen). Scheduling and
 * cancellation never move cash: only the atomic MONEY-07 payment path can.
 */
export async function transitionObligation(
  actor: AuthenticatedActor,
  repository: ObligationRepository,
  id: unknown,
  input: unknown,
  options: Readonly<{ now?: Date }> = {},
): Promise<ApplicationResult<ObligationOccurrence>> {
  const validId = validateId(id);
  if (!validId) return applicationFailure(NOT_FOUND, "notFound");

  const parsed = parseObligationTransitionInput(input);
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");

  const current = await repository.get(actor, validId);
  if (!current.ok) {
    return failureFor(
      current.error.code,
      "Unable to load the obligation right now.",
    );
  }
  if (!current.value) return applicationFailure(NOT_FOUND, "notFound");
  const occurrence = current.value;

  const decision = decideObligationTransition({
    from: occurrence.state,
    to: parsed.value.to,
    effectiveDate: parsed.value.effectiveDate,
    currentEffectiveDate: occurrence.stateEffectiveDate,
  });
  if (!decision.ok) {
    return applicationFailure(
      decision.message,
      decision.reason === "invalid_effective_date" ||
        decision.reason === "no_change"
        ? "validation"
        : "conflict",
    );
  }

  const now = options.now ?? new Date();
  const result = await repository.transition(actor, validId, {
    fromState: occurrence.state,
    to: parsed.value.to,
    effectiveDate: parsed.value.effectiveDate,
    reason: parsed.value.reason,
    expectedVersion: parsed.value.expectedVersion,
    updatedAt: now.toISOString(),
  });
  if (!result.ok) {
    return failureFor(result.error.code, "Unable to change the obligation right now.");
  }
  return applicationSuccess(result.value);
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

export async function getObligationTemplate(
  actor: AuthenticatedActor,
  repository: ObligationRepository,
  id: unknown,
): Promise<ApplicationResult<ObligationTemplate>> {
  const validId = validateId(id);
  if (!validId) return applicationFailure(TEMPLATE_NOT_FOUND, "notFound");

  const result = await repository.getTemplate(actor, validId);
  if (!result.ok) {
    return failureFor(
      result.error.code,
      "Unable to load the obligation template right now.",
    );
  }
  if (!result.value) return applicationFailure(TEMPLATE_NOT_FOUND, "notFound");
  return applicationSuccess(result.value);
}

export async function listObligationTemplates(
  actor: AuthenticatedActor,
  repository: ObligationRepository,
  input: unknown,
): Promise<ApplicationResult<ObligationTemplateListOutcome>> {
  const parsed = parseObligationTemplateListQuery(input);
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");
  const query: ObligationTemplateListRecordQuery = parsed.value;

  const result = await repository.listTemplates(actor, query);
  if (!result.ok) {
    return failureFor(
      result.error.code,
      "Unable to load obligation templates right now.",
    );
  }
  return applicationSuccess({ templates: result.value });
}

export async function createObligationTemplate(
  actor: AuthenticatedActor,
  repository: ObligationRepository,
  input: unknown,
): Promise<ApplicationResult<ObligationTemplate>> {
  const parsed = parseCreateObligationTemplateInput(input);
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");

  const values: ObligationTemplateCreateValues = parsed.value;
  const createFingerprint = obligationTemplateReceiptFingerprint(values);

  const existing = await repository.findTemplateByIdempotencyKey(
    actor,
    values.idempotencyKey,
  );
  if (!existing.ok) {
    return failureFor(
      existing.error.code,
      "Unable to save the obligation template right now.",
    );
  }
  if (existing.value) {
    if (existing.value.createFingerprint !== createFingerprint) {
      return applicationFailure(TEMPLATE_IDEMPOTENCY_CONFLICT, "conflict");
    }
    return applicationSuccess(existing.value.template);
  }

  const created = await repository.createTemplate(actor, {
    values,
    createFingerprint,
  });
  if (created.ok) return applicationSuccess(created.value);

  if (created.error.code === "conflict") {
    const raced = await repository.findTemplateByIdempotencyKey(
      actor,
      values.idempotencyKey,
    );
    if (raced.ok) {
      if (raced.value) {
        if (raced.value.createFingerprint !== createFingerprint) {
          return applicationFailure(TEMPLATE_IDEMPOTENCY_CONFLICT, "conflict");
        }
        return applicationSuccess(raced.value.template);
      }
      return applicationFailure(TEMPLATE_IDEMPOTENCY_CONFLICT, "conflict");
    }
    return failureFor(
      raced.error.code,
      "Unable to save the obligation template right now.",
    );
  }
  return failureFor(
    created.error.code,
    "Unable to save the obligation template right now.",
  );
}

export async function updateObligationTemplate(
  actor: AuthenticatedActor,
  repository: ObligationRepository,
  id: unknown,
  input: unknown,
  options: Readonly<{ now?: Date }> = {},
): Promise<ApplicationResult<ObligationTemplate>> {
  const validId = validateId(id);
  if (!validId) return applicationFailure(TEMPLATE_NOT_FOUND, "notFound");

  const parsed = parseUpdateObligationTemplateInput(input);
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");

  const current = await repository.getTemplate(actor, validId);
  if (!current.ok) {
    return failureFor(
      current.error.code,
      "Unable to load the obligation template right now.",
    );
  }
  if (!current.value) return applicationFailure(TEMPLATE_NOT_FOUND, "notFound");

  const { expectedVersion, ...changes } = parsed.value;
  const merged = {
    cadence: changes.cadence ?? current.value.cadence,
    dueDayOfMonth:
      changes.dueDayOfMonth !== undefined
        ? changes.dueDayOfMonth
        : current.value.dueDayOfMonth,
    dueWeekday:
      changes.dueWeekday !== undefined
        ? changes.dueWeekday
        : current.value.dueWeekday,
  };
  if (merged.cadence === "weekly") {
    if (merged.dueWeekday === null) {
      return applicationFailure(
        "A weekly template needs a weekday from 0 (Sunday) to 6 (Saturday).",
        "validation",
      );
    }
    if (merged.dueDayOfMonth !== null) {
      return applicationFailure(
        "A weekly template uses a weekday, not a day of month.",
        "validation",
      );
    }
  } else {
    if (merged.dueDayOfMonth === null) {
      return applicationFailure(
        "Choose a day of month from 1 to 31.",
        "validation",
      );
    }
    if (merged.dueWeekday !== null) {
      return applicationFailure(
        "Only a weekly template uses a weekday.",
        "validation",
      );
    }
  }

  const startDate = changes.startDate ?? current.value.startDate;
  const endDate = changes.endDate !== undefined ? changes.endDate : current.value.endDate;
  if (endDate !== null && endDate < startDate) {
    return applicationFailure(
      "The end date must be on or after the start date.",
      "validation",
    );
  }

  const now = options.now ?? new Date();
  return fromRepository(
    await repository.updateTemplate(actor, validId, {
      changes,
      expectedVersion,
      updatedAt: now.toISOString(),
    }),
    "Unable to save the obligation template right now.",
  );
}

/* -------------------------------------------------------------------------- */
/* Generation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Materialise template occurrences through `throughDate`. Generation is
 * idempotent per template period and bounded; a template edit never rewrites
 * occurrences already generated.
 */
export async function generateObligations(
  actor: AuthenticatedActor,
  repository: ObligationRepository,
  input: unknown,
): Promise<ApplicationResult<GenerateObligationsOutcome>> {
  const parsed = parseObligationGenerationInput(input);
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");

  const templateResult = await repository.getTemplate(
    actor,
    parsed.value.templateId,
  );
  if (!templateResult.ok) {
    return failureFor(
      templateResult.error.code,
      "Unable to load the obligation template right now.",
    );
  }
  const template = templateResult.value;
  if (!template) return applicationFailure(TEMPLATE_NOT_FOUND, "notFound");
  if (template.lifecycle !== "active") {
    return applicationFailure(
      "This template is archived; reactivate it before generating occurrences.",
      "validation",
    );
  }

  const plan = listObligationPeriodStarts(template, parsed.value.throughDate);
  const classification = resolveObligationClassification({
    kind: template.kind,
    template: templateClassificationSource(template),
  });

  const occurrences: ObligationOccurrence[] = [];
  let created = 0;
  let existing = 0;

  for (const periodStart of plan.periodStarts) {
    const periodEnd = endOfObligationPeriod(periodStart, template.cadence);
    const dueDate = dueDateForObligationPeriod(
      {
        cadence: template.cadence,
        dueDayOfMonth: template.dueDayOfMonth,
        dueWeekday: template.dueWeekday,
      },
      periodStart,
    );
    const values: ObligationCreateValues = {
      kind: template.kind,
      description: template.description,
      amountMinor: template.amountMinor,
      periodStart,
      periodEnd,
      dueDate,
      needVsWant: classification.needVsWant,
      purpose: classification.purpose,
      countsInDaily: classification.countsInDaily,
      category: classification.category,
      // The occurrence is pending from its own period start; no "today" is
      // invented, so regenerating later cannot drift.
      stateEffectiveDate: periodStart,
      templateId: template.id,
      idempotencyKey: `obligation-template:${template.id}:${periodStart}`,
    };
    const createFingerprint = obligationReceiptFingerprint(values);

    const receipt = await repository.findByIdempotencyKey(
      actor,
      values.idempotencyKey,
    );
    if (!receipt.ok) {
      return failureFor(
        receipt.error.code,
        "Unable to generate obligations right now.",
      );
    }
    if (receipt.value) {
      existing += 1;
      occurrences.push(receipt.value.occurrence);
      continue;
    }

    const result = await repository.create(actor, { values, createFingerprint });
    if (result.ok) {
      created += 1;
      occurrences.push(result.value);
      continue;
    }
    if (result.error.code === "conflict") {
      const raced = await repository.findByIdempotencyKey(
        actor,
        values.idempotencyKey,
      );
      if (raced.ok && raced.value) {
        existing += 1;
        occurrences.push(raced.value.occurrence);
        continue;
      }
      // Another occurrence already owns this template period.
      existing += 1;
      continue;
    }
    return failureFor(result.error.code, "Unable to generate obligations right now.");
  }

  return applicationSuccess({
    templateId: template.id,
    throughDate: parsed.value.throughDate,
    created,
    existing,
    occurrences,
    truncated: plan.truncated,
  });
}

/* -------------------------------------------------------------------------- */
/* Payment seam helpers (MONEY-07 calls these)                                */
/* -------------------------------------------------------------------------- */

/**
 * Pre-flight guard for the MONEY-07 atomic payment. Rejects partial,
 * overpayment, wrong-currency/direction, deleted/foreign payments and
 * non-pending occurrences with an actionable message.
 */
export function assertObligationPaymentSeam(
  occurrence: Pick<ObligationOccurrence, "state" | "amountMinor" | "currency">,
  payment: Readonly<{
    expenseId: string;
    amountMinor: number;
    currency: string;
    direction: string;
    bookingDate: string;
  }>,
): ApplicationResult<null> {
  const validation = validateObligationPayment(occurrence, payment);
  if (!validation.ok) {
    return applicationFailure(
      validation.message,
      validation.reason === "invalid_booking_date" ? "validation" : "conflict",
    );
  }
  return applicationSuccess(null);
}

/**
 * Classification a payment must persist. MONEY-07 calls this with the payment
 * input so need/want is requested when still unknown instead of fabricated.
 */
export function resolvePaymentObligationClassification(
  occurrence: ObligationOccurrence,
  template: ObligationTemplate | null,
  payment: Readonly<{
    needVsWant?: ExpenseNeedVsWant | null;
    purpose?: MoneyPurpose | null;
    countsInDaily?: boolean | null;
    category?: ExpenseCategory | null;
  }> = {},
): ApplicationResult<
  ResolvedObligationClassification & { missing: readonly string[] }
> {
  const classification = resolveObligationClassification({
    kind: occurrence.kind,
    template: templateClassificationSource(template),
    occurrence: {
      needVsWant: occurrence.needVsWant,
      purpose: occurrence.purpose,
      countsInDaily: occurrence.countsInDaily,
      category: occurrence.category,
    },
    payment,
  });
  return applicationSuccess({
    ...classification,
    missing: missingPaymentClassification(classification),
  });
}
