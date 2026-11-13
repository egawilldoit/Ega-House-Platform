import type { MoneyOpeningInput, MoneyPeriodLifecycle, MoneyPeriodProvenance } from "@ega/domain/money";
import { canonicalMoneyOpeningPayload } from "@ega/domain/money";
import {
  assessMoneyRollover,
  buildCarryForwardOpening,
  buildVerifiedRolloverOpening,
  defaultMoneyRolloverRange,
  generateMoneyPeriodWeekWindows,
  moneyRolloverSourceFailure,
  parseMoneyRolloverInput,
  resolveMoneyRolloverSettings,
  shiftDueDateIntoPeriod,
  validateMoneyRolloverTargets,
  type MoneyRolloverReconciliation,
  type MoneyRolloverTargets,
  type MoneyRolloverValues,
} from "@ega/domain/money-rollover";
import {
  dueDateForObligationPeriod,
  endOfObligationPeriod,
  listObligationPeriodStarts,
  resolveObligationClassification,
  templateClassificationSource,
  type ObligationCreateValues,
  type ObligationTemplate,
} from "@ega/domain/obligations";

import type { AuthenticatedActor } from "../auth/actor";
import { sha256Hex } from "../shared/hash";
import {
  applicationFailure,
  applicationSuccess,
  type ApplicationResult,
} from "../shared/result";
import type { ObligationRepository } from "./obligation-ports";
import { obligationReceiptFingerprint } from "./obligations";
import type {
  MoneyRolloverCarryItem,
  MoneyRolloverObligationPlanItem,
  MoneyRolloverRecord,
  MoneyRolloverRepository,
  MoneyRolloverSourceContext,
  MoneyRolloverWriteInput,
} from "./rollover-ports";

/**
 * Explicit period rollover (MONEY-10).
 *
 * The application composes canonical domain rules (dates, recurrence,
 * reconciliation, bridge identity) and delegates the single atomic write to the
 * repository port. It never creates a second ledger, opening or obligation
 * model: the successor opening is the canonical `opening` movement and
 * generated occurrences use the MONEY-06 template rules.
 *
 * Integration dependency (MONEY-09): the source must already be finished by the
 * durable day close (`lifecycle = 'ended'`, `activeDate = endDate`). Stored close
 * snapshots are read from `money_day_closes` and compared with live restated
 * totals; a changed or unavailable comparison is an explicit decision, never a
 * passed check.
 */

export type MoneyRolloverSurface = "web" | "mcp";

export type MoneyRolloverOptions = Readonly<{
  now?: Date;
  surface?: MoneyRolloverSurface;
  /**
   * Accepted for surface symmetry with the other Money use cases. The
   * successor inherits the source period's stored timezone; rollover never
   * reinterprets stored booking dates with a caller-supplied zone.
   */
  timezone?: string | null;
}>;

export type MoneyRolloverPreview = Readonly<{
  source: Readonly<{
    periodId: string;
    startDate: string;
    endDate: string;
    version: number;
    lifecycle: MoneyPeriodLifecycle;
    activeDate: string;
    timezone: string;
  }>;
  targets: MoneyRolloverTargets;
  openingMode: MoneyRolloverValues["opening"]["mode"];
  modeledClosingCashMinor: number | null;
  /** Amount the successor opening would carry when nothing is decided yet. */
  proposedOpeningMinor: number | null;
  settings: Readonly<Record<string, unknown>>;
  reconciliation: MoneyRolloverReconciliation;
  /** Stored close evidence and the live restatement comparison it powered. */
  closeSnapshots: MoneyRolloverSourceContext["closeSnapshots"];
  pendingOccurrences: MoneyRolloverSourceContext["pendingOccurrences"];
  generatedObligations: readonly Readonly<{
    templateId: string;
    description: string;
    amountMinor: number;
    periodStart: string;
    periodEnd: string;
    dueDate: string;
  }>[];
  carriedOccurrences: readonly Readonly<{
    occurrenceId: string;
    description: string;
    amountMinor: number;
    dueDate: string;
  }>[];
  weekWindows: ReturnType<typeof generateMoneyPeriodWeekWindows>;
  /** True only when every explicit decision is present. */
  ready: boolean;
  choices: readonly string[];
  blockers: readonly string[];
}>;

export type MoneyRolloverOutcome = Readonly<{
  record: MoneyRolloverRecord;
  replayed: boolean;
  reconciliation: MoneyRolloverReconciliation;
  weekWindows: ReturnType<typeof generateMoneyPeriodWeekWindows>;
}>;

type PreparationFailure = Readonly<{
  ok: false;
  code: "validation" | "notFound" | "conflict" | "forbidden" | "unknown";
  message: string;
}>;

type Prepared = Readonly<{
  source: MoneyRolloverSourceContext;
  values: MoneyRolloverValues;
  targets: MoneyRolloverTargets;
  opening: MoneyOpeningInput | null;
  initialized: "initialized" | "reconciled";
  reconciliation: MoneyRolloverReconciliation;
  obligations: readonly MoneyRolloverObligationPlanItem[];
  carried: readonly MoneyRolloverCarryItem[];
  ready: boolean;
}>;

function repositoryFailure(
  code: string | undefined,
  fallback: string,
): ApplicationResult<never> {
  if (code === "notFound") return applicationFailure(fallback, "notFound");
  if (code === "conflict") return applicationFailure(fallback, "conflict");
  if (code === "forbidden") {
    return applicationFailure(
      "You do not have permission to roll over Money periods.",
      "forbidden",
    );
  }
  return applicationFailure(fallback, "unknown");
}

function buildProvenance(
  opening: MoneyOpeningInput,
  recordedAt: string,
  surface: MoneyRolloverSurface,
): MoneyPeriodProvenance {
  return {
    opening: {
      source: opening.source,
      recordedAt,
      cutoffDate: opening.cutoffDate,
      evidence: opening.evidence,
      note: opening.note,
      corrections: [],
    },
    createdFrom: surface,
  };
}

/**
 * The planned occurrence set for the successor window. Existing periods keep
 * their identity, so the database's `(owner, template_id, period_start)`
 * uniqueness makes regeneration idempotent rather than duplicated.
 */
function planGeneratedOccurrences(
  templates: readonly ObligationTemplate[],
  targets: MoneyRolloverTargets,
): MoneyRolloverObligationPlanItem[] {
  const plan: MoneyRolloverObligationPlanItem[] = [];
  for (const template of templates) {
    if (template.lifecycle !== "active") continue;
    const starts = listObligationPeriodStarts(template, targets.endDate);
    for (const periodStart of starts.periodStarts) {
      const periodEnd = endOfObligationPeriod(periodStart, template.cadence);
      if (periodEnd < targets.startDate) continue;
      if (periodStart > targets.endDate) continue;
      const dueDate = dueDateForObligationPeriod(
        {
          cadence: template.cadence,
          dueDayOfMonth: template.dueDayOfMonth,
          dueWeekday: template.dueWeekday,
        },
        periodStart,
      );
      const classification = resolveObligationClassification({
        kind: template.kind,
        template: templateClassificationSource(template),
      });
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
        stateEffectiveDate: periodStart,
        templateId: template.id,
        idempotencyKey: `obligation-template:${template.id}:${periodStart}`,
      };
      plan.push({ values, createFingerprint: obligationReceiptFingerprint(values) });
    }
  }
  return plan;
}

function planCarriedOccurrences(
  source: MoneyRolloverSourceContext,
  targets: MoneyRolloverTargets,
): MoneyRolloverCarryItem[] {
  // Template-backed occurrences are regenerated by their template for the new
  // period, so carrying them too would duplicate the same obligation.
  return source.pendingOccurrences
    .filter((occurrence) => occurrence.templateId === null)
    .map((occurrence) => {
      const dueDate = shiftDueDateIntoPeriod({
        dueDate: occurrence.dueDate,
        sourceStartDate: source.period.startDate,
        targetStartDate: targets.startDate,
        targetEndDate: targets.endDate,
      });
      // The receipt mirrors the classification the atomic write copies from the
      // canonical source row, so the fingerprint never describes different data.
      // A legacy occurrence with no stored category falls back to its kind
      // default instead of inventing an unrelated category or writing null.
      const classification = resolveObligationClassification({
        kind: occurrence.kind,
        occurrence: {
          needVsWant: occurrence.needVsWant,
          purpose: occurrence.purpose,
          countsInDaily: occurrence.countsInDaily,
          ...(occurrence.category === null
            ? {}
            : { category: occurrence.category }),
        },
      });
      const values: ObligationCreateValues = {
        kind: occurrence.kind,
        description: occurrence.description,
        amountMinor: occurrence.amountMinor,
        periodStart: targets.startDate,
        periodEnd: targets.endDate,
        dueDate,
        needVsWant: classification.needVsWant,
        purpose: classification.purpose,
        countsInDaily: classification.countsInDaily,
        category: classification.category,
        stateEffectiveDate: targets.startDate,
        templateId: null,
        idempotencyKey: `rollover-carry:${targets.startDate}:${occurrence.id}`,
      };
      return {
        occurrenceId: occurrence.id,
        periodStart: targets.startDate,
        periodEnd: targets.endDate,
        dueDate,
        idempotencyKey: values.idempotencyKey,
        createFingerprint: obligationReceiptFingerprint(values),
      };
    });
}

/**
 * Shared preview/write preparation. This is the one place that decides whether
 * a rollover request is complete; the preflight surface and the write surface
 * cannot disagree about what is missing.
 */
async function prepareRollover(
  actor: AuthenticatedActor,
  dependencies: Readonly<{
    repository: MoneyRolloverRepository;
    obligations: Pick<ObligationRepository, "listTemplates">;
  }>,
  input: unknown,
  options: MoneyRolloverOptions,
): Promise<Readonly<{ ok: true; value: Prepared }> | PreparationFailure> {
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    return { ok: false, code: "validation", message: "Current time is invalid." };
  }
  const parsed = parseMoneyRolloverInput(input);
  if (!parsed.ok) {
    return { ok: false, code: "validation", message: parsed.message };
  }
  const values = parsed.value;

  const contextResult = await dependencies.repository.getSourceContext(
    actor,
    values.sourcePeriodId,
  );
  if (!contextResult.ok) {
    return {
      ok: false,
      code: contextResult.error.code ?? "unknown",
      message: "Unable to load the source period right now.",
    };
  }
  const source = contextResult.value;
  if (!source) {
    return {
      ok: false,
      code: "notFound",
      message: "The source Money period was not found.",
    };
  }
  if (source.period.version !== values.expectedVersion) {
    return {
      ok: false,
      code: "conflict",
      message:
        "The source period changed since you read it. Refresh before rolling it over.",
    };
  }

  const sourceFailure = moneyRolloverSourceFailure(source.period);
  if (sourceFailure) {
    return { ok: false, code: "validation", message: sourceFailure.message };
  }
  if (source.existingSuccessorPeriodId) {
    return {
      ok: false,
      code: "conflict",
      message:
        "This period already has a successor. Continue from that period instead of creating a second one.",
    };
  }

  const targetsResult = validateMoneyRolloverTargets({
    source: source.period,
    startDate: values.startDate,
    endDate: values.endDate,
    allowUncoveredDays: values.allowUncoveredDays,
  });
  if (!targetsResult.ok) {
    return { ok: false, code: "validation", message: targetsResult.message };
  }
  const targets = targetsResult.value;

  if (!source.cashComplete) {
    return {
      ok: false,
      code: "validation",
      message:
        "Closing cash is unavailable because the ledger window exceeded the bounded aggregation limit. Narrow or repair the ledger before rolling over.",
    };
  }

  let opening: MoneyOpeningInput | null = null;
  let initialized: "initialized" | "reconciled" = "initialized";
  let verifiedClosingCashMinor: number | null = null;
  let openingFailure: PreparationFailure | null = null;

  if (values.opening.mode === "carry_forward") {
    if (source.modeledClosingCashMinor === null) {
      openingFailure = {
        ok: false,
        code: "validation",
        message:
          "Closing cash is unknown, so it cannot be carried forward as zero. Initialize the source period or supply a verified opening.",
      };
    } else {
      opening = buildCarryForwardOpening({
        sourcePeriodId: source.period.id,
        sourceEndDate: source.period.endDate,
        closingCashMinor: source.modeledClosingCashMinor,
      });
      initialized = "initialized";
    }
  } else {
    const verified = values.opening;
    if (
      verified.cutoffDate < source.period.endDate ||
      verified.cutoffDate > targets.startDate
    ) {
      openingFailure = {
        ok: false,
        code: "validation",
        message: `The verified opening cutoff must cover the source close and not extend past the successor start (${source.period.endDate} through ${targets.startDate}).`,
      };
    } else {
      opening = buildVerifiedRolloverOpening(verified, source.period);
      initialized = "reconciled";
      verifiedClosingCashMinor = verified.amountMinor;
    }
  }

  const reconciliation = assessMoneyRollover({
    cutoffDate: source.period.endDate,
    modeledClosingCashMinor: source.modeledClosingCashMinor,
    verifiedClosingCashMinor,
    differenceAccepted: values.acceptClosingDifferenceNote !== null,
    pendingOccurrences: source.pendingOccurrences,
    unpaidChoice: values.unpaidItems,
    openingMode: values.opening.mode,
    closeSnapshots: source.closeSnapshots,
  });

  const templatesResult = await dependencies.obligations.listTemplates(actor, {
    kind: null,
    includeArchived: false,
  });
  if (!templatesResult.ok) {
    return {
      ok: false,
      code: templatesResult.error.code ?? "unknown",
      message: "Unable to load obligation templates right now.",
    };
  }

  const blockers = [
    ...reconciliation.blockers,
    ...(openingFailure ? [openingFailure.message] : []),
  ];
  const obligations =
    blockers.length === 0 ? planGeneratedOccurrences(templatesResult.value, targets) : [];
  const carried =
    blockers.length === 0 && values.unpaidItems?.treatment === "carry_forward"
      ? planCarriedOccurrences(source, targets)
      : [];

  return {
    ok: true,
    value: {
      source,
      values,
      targets,
      opening,
      initialized,
      reconciliation: { ...reconciliation, blockers },
      obligations,
      carried,
      ready:
        blockers.length === 0 &&
        reconciliation.choices.length === 0 &&
        opening !== null,
    },
  };
}

function previewOf(prepared: Prepared): MoneyRolloverPreview {
  const { source, values, targets, opening, reconciliation, obligations, carried } =
    prepared;
  return {
    source: {
      periodId: source.period.id,
      startDate: source.period.startDate,
      endDate: source.period.endDate,
      version: source.period.version,
      lifecycle: source.period.lifecycle,
      activeDate: source.period.activeDate,
      timezone: source.period.timezone,
    },
    targets,
    openingMode: values.opening.mode,
    modeledClosingCashMinor: source.modeledClosingCashMinor,
    proposedOpeningMinor: opening?.amountMinor ?? null,
    settings: resolveMoneyRolloverSettings(
      source.period.settings,
      values.settingsOverrides,
    ),
    reconciliation,
    closeSnapshots: source.closeSnapshots,
    pendingOccurrences: source.pendingOccurrences,
    generatedObligations: obligations.map((item) => ({
      templateId: item.values.templateId ?? "",
      description: item.values.description,
      amountMinor: item.values.amountMinor,
      periodStart: item.values.periodStart,
      periodEnd: item.values.periodEnd,
      dueDate: item.values.dueDate,
    })),
    carriedOccurrences: carried.map((item) => {
      const occurrence = source.pendingOccurrences.find(
        (entry) => entry.id === item.occurrenceId,
      );
      return {
        occurrenceId: item.occurrenceId,
        description: occurrence?.description ?? "",
        amountMinor: occurrence?.amountMinor ?? 0,
        dueDate: item.dueDate,
      };
    }),
    weekWindows: generateMoneyPeriodWeekWindows({
      startDate: targets.startDate,
      endDate: targets.endDate,
      timezone: targets.timezone,
    }),
    ready: prepared.ready,
    choices: reconciliation.choices,
    blockers: reconciliation.blockers,
  };
}

/**
 * Preview the successor without writing. Missing decisions are returned as
 * `choices` with `ready: false`, not as a fabricated success.
 */
export async function getMoneyRolloverPreview(
  actor: AuthenticatedActor,
  dependencies: Readonly<{
    repository: MoneyRolloverRepository;
    obligations: Pick<ObligationRepository, "listTemplates">;
  }>,
  input: unknown,
  options: MoneyRolloverOptions = {},
): Promise<ApplicationResult<MoneyRolloverPreview>> {
  const prepared = await prepareRollover(actor, dependencies, input, options);
  if (!prepared.ok) return applicationFailure(prepared.message, prepared.code);
  return applicationSuccess(previewOf(prepared.value));
}

/** Roll over exactly once. Retries replay the original result, never a duplicate. */
export async function rolloverMoneyPeriod(
  actor: AuthenticatedActor,
  dependencies: Readonly<{
    repository: MoneyRolloverRepository;
    obligations: Pick<ObligationRepository, "listTemplates">;
  }>,
  input: unknown,
  operationId: unknown,
  options: MoneyRolloverOptions = {},
): Promise<ApplicationResult<MoneyRolloverOutcome>> {
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    return applicationFailure("Current time is invalid.", "validation");
  }
  if (
    typeof operationId !== "string" ||
    !operationId.trim() ||
    operationId.trim().length > 128
  ) {
    return applicationFailure(
      "A stable operation id of at most 128 characters is required.",
      "validation",
    );
  }
  const parsed = parseMoneyRolloverInput(input);
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");

  const operation = operationId.trim();
  const requestFingerprint = sha256Hex(
    JSON.stringify({ operation, payload: parsed.value }),
  );

  // Replay before any decision check: an identical retry must return the
  // original successor even if the owner later changed the source period.
  const existing = await dependencies.repository.findRolloverByOperation(
    actor,
    operation,
  );
  if (!existing.ok) {
    return repositoryFailure(
      existing.error.code,
      "Unable to check the rollover operation right now.",
    );
  }
  if (existing.value) {
    if (existing.value.requestFingerprint !== requestFingerprint) {
      return applicationFailure(
        "This operation id was used for a different rollover request. Use a new operation id for a new rollover.",
        "conflict",
      );
    }
    const record = existing.value;
    const successor = record.successorPeriod;
    return applicationSuccess({
      record,
      replayed: true,
      reconciliation: {
        currency: "MAD",
        cutoffDate: record.closingCutoffDate,
        modeledClosingCashMinor: record.closingCashMinor,
        verifiedClosingCashMinor:
          record.openingMode === "verified_source" ? record.openingAmountMinor : null,
        differenceMinor: null,
        differenceAccepted: record.reconciliationAcceptedNote !== null,
        pendingOccurrenceCount: 0,
        pendingOccurrenceMinor: 0,
        choices: [],
        blockers: [],
        differences: [],
      },
      weekWindows: successor
        ? generateMoneyPeriodWeekWindows({
            startDate: successor.startDate,
            endDate: successor.endDate,
            timezone: successor.timezone,
          })
        : [],
    });
  }

  const prepared = await prepareRollover(actor, dependencies, parsed.value, options);
  if (!prepared.ok) return applicationFailure(prepared.message, prepared.code);
  const { source, values, targets, opening, initialized, reconciliation, obligations, carried } =
    prepared.value;
  if (!prepared.value.ready || opening === null) {
    return applicationFailure(
      `Rollover needs explicit decisions: ${[...reconciliation.blockers, ...reconciliation.choices].join(" ")}`,
      "validation",
    );
  }

  const surface = options.surface ?? "web";
  const createdAt = now.toISOString();
  const writeInput: MoneyRolloverWriteInput = {
    values,
    targets,
    opening,
    initialized,
    provenance: buildProvenance(opening, createdAt, surface),
    settings: resolveMoneyRolloverSettings(
      source.period.settings,
      values.settingsOverrides,
    ),
    operationId: operation,
    requestFingerprint,
    openingCreateFingerprint: sha256Hex(canonicalMoneyOpeningPayload(opening)),
    reconciliation,
    reconciliationAcceptedNote: values.acceptClosingDifferenceNote,
    obligations,
    carriedOccurrences: carried,
    createdAt,
  };

  const result = await dependencies.repository.rollover(actor, writeInput);
  if (!result.ok) {
    return repositoryFailure(
      result.error.code,
      "Unable to roll over the Money period right now.",
    );
  }
  return applicationSuccess({
    record: result.value.record,
    replayed: result.value.replayed,
    reconciliation,
    weekWindows: generateMoneyPeriodWeekWindows({
      startDate: targets.startDate,
      endDate: targets.endDate,
      timezone: targets.timezone,
    }),
  });
}

/** Default successor range for a source period; used by both surfaces. */
export function defaultRolloverRangeFor(source: {
  startDate: string;
  endDate: string;
}): { startDate: string; endDate: string } {
  return defaultMoneyRolloverRange(source);
}

/**
 * Preview convenience for a selected source period without a chosen date range.
 * It derives the documented successor defaults and leaves every decision open,
 * so the caller sees what must be chosen before the write.
 */
export async function getMoneyRolloverPreviewForPeriod(
  actor: AuthenticatedActor,
  dependencies: Readonly<{
    repository: MoneyRolloverRepository;
    obligations: Pick<ObligationRepository, "listTemplates">;
  }>,
  periodId: unknown,
  options: MoneyRolloverOptions = {},
): Promise<ApplicationResult<MoneyRolloverPreview>> {
  if (typeof periodId !== "string" || !periodId.trim()) {
    return applicationFailure("A valid source period ID is required.", "validation");
  }
  const contextResult = await dependencies.repository.getSourceContext(
    actor,
    periodId.trim(),
  );
  if (!contextResult.ok) {
    return repositoryFailure(
      contextResult.error.code,
      "Unable to load the source period right now.",
    );
  }
  const source = contextResult.value;
  if (!source) {
    return applicationFailure("The source Money period was not found.", "notFound");
  }
  const range = defaultMoneyRolloverRange(source.period);
  return getMoneyRolloverPreview(
    actor,
    dependencies,
    {
      sourcePeriodId: source.period.id,
      expectedVersion: source.period.version,
      startDate: range.startDate,
      endDate: range.endDate,
      opening: { mode: "carry_forward" },
      unpaidItems: null,
      settingsOverrides: null,
      allowUncoveredDays: false,
      acceptClosingDifferenceNote: null,
    },
    options,
  );
}
