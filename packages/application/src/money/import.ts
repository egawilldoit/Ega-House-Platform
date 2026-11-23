import {
  buildMoneyImportManifest,
  canonicalMoneyImportManifestPayload,
  canonicalMoneyImportSnapshotPayload,
  createMoneyImportSnapshot,
  isMoneyImportOpeningStrategy,
  moneyImportCashEquation,
  moneyImportCoffeeVisitKey,
  moneyImportMovementKey,
  moneyImportTargetDrift,
  parseMoneyImportCutover,
  validateMoneyImportApproval,
  type MoneyImportAdoptionStatus,
  type MoneyImportApproval,
  type MoneyImportCandidate,
  type MoneyImportCutover,
  type MoneyImportManifest,
  type MoneyImportOpeningStrategy,
  type MoneyImportSourceSnapshot,
  type MoneyImportTarget,
} from "@ega/domain/money-import";

import type { AuthenticatedActor } from "../auth/actor";
import { sha256Hex } from "../shared/hash";
import {
  applicationFailure,
  applicationSuccess,
  type ApplicationResult,
} from "../shared/result";
import { recordMoneyCoffeeVisit } from "./coffee";
import type {
  MoneyImportAdoptionFields,
  MoneyImportAdoptionRecord,
  MoneyImportAppliedCounts,
  MoneyImportPostReconciliation,
  MoneyImportTargetMovement,
  NovemberImportDependencies,
} from "./import-ports";
import { createMoneyPeriod } from "./periods";
import { createMovement } from "./service";

/**
 * November workbook adoption use cases (MONEY-001-B).
 *
 * Preview is a pure read over frozen source data plus owner-scoped target
 * reads. Apply is gated by the exact approved manifest and writes only through
 * the canonical Money application writers (`createMoneyPeriod`,
 * `createMovement`, `recordMoneyCoffeeVisit`). The adoption receipt is the only
 * new persistence and it stores evidence, not a second ledger.
 */

export type FrozenNovemberImportSnapshot = Readonly<{
  snapshot: MoneyImportSourceSnapshot;
  snapshotDigest: string;
  frozenAt: string;
}>;

export type NovemberImportTarget = Readonly<{
  ownerId: string;
  environment: string;
}>;

export type NovemberImportPreviewRequest = Readonly<{
  snapshot: MoneyImportSourceSnapshot;
  target: NovemberImportTarget;
  cutover: MoneyImportCutover;
  openingStrategy?: MoneyImportOpeningStrategy;
  expectedEnvironment: string;
  now?: Date;
}>;

export type NovemberImportPreviewOutcome = Readonly<{
  manifest: MoneyImportManifest;
  manifestDigest: string;
  snapshotDigest: string;
  readOnly: true;
}>;

export type NovemberImportApplyRequest = Readonly<{
  snapshot: MoneyImportSourceSnapshot;
  approval: MoneyImportApproval;
  target: NovemberImportTarget;
  cutover: MoneyImportCutover;
  openingStrategy?: MoneyImportOpeningStrategy;
  expectedEnvironment: string;
  now?: Date;
}>;

export type NovemberImportApplyOutcome = Readonly<{
  status: MoneyImportAdoptionStatus;
  replay: boolean;
  receipt: MoneyImportAdoptionRecord;
  manifestDigest: string;
  snapshotDigest: string;
  periodId: string | null;
  appliedCounts: MoneyImportAppliedCounts | null;
  postReconciliation: MoneyImportPostReconciliation | null;
}>;

export type NovemberImportStatusOutcome = Readonly<{
  snapshotId: string;
  status: MoneyImportAdoptionStatus;
  manifestDigest: string;
  snapshotDigest: string;
  openingStrategy: MoneyImportOpeningStrategy;
  cutoverDate: string;
  appliedCounts: MoneyImportAppliedCounts | null;
  postReconciliation: MoneyImportPostReconciliation | null;
  appliedAt: string | null;
  updatedAt: string;
}>;

type PeriodPreflight =
  | Readonly<{ kind: "create" }>
  | Readonly<{ kind: "reuse"; periodId: string }>;

function snapshotDigestOf(snapshot: MoneyImportSourceSnapshot): string {
  return sha256Hex(canonicalMoneyImportSnapshotPayload(snapshot));
}

function manifestDigestOf(manifest: MoneyImportManifest): string {
  return sha256Hex(canonicalMoneyImportManifestPayload(manifest));
}

function withSnapshotDigest(
  manifest: MoneyImportManifest,
  snapshotDigest: string,
): MoneyImportManifest {
  return Object.freeze({ ...manifest, snapshotDigest });
}

function scopeFailure(
  actor: AuthenticatedActor,
  target: NovemberImportTarget,
  expectedEnvironment: string,
): ApplicationResult<never> | null {
  if (!target || typeof target.ownerId !== "string" || typeof target.environment !== "string") {
    return applicationFailure("The import target is incomplete.", "validation");
  }
  if (target.ownerId.trim() !== actor.userId) {
    return applicationFailure(
      "You do not have permission to import into this owner.",
      "forbidden",
    );
  }
  if (target.environment !== expectedEnvironment) {
    return applicationFailure(
      "The import target environment does not match this deployment.",
      "forbidden",
    );
  }
  return null;
}

function approvalShapeFailure(
  approval: NovemberImportApplyRequest["approval"] | null | undefined,
): string | null {
  if (!approval || typeof approval !== "object") {
    return "An explicit approved manifest is required before writing.";
  }
  if (approval.status !== "approved") {
    return "The workbook manifest is not approved.";
  }
  if (
    typeof approval.manifestDigest !== "string" ||
    typeof approval.snapshotDigest !== "string" ||
    typeof approval.ownerId !== "string" ||
    typeof approval.environment !== "string" ||
    typeof approval.approvedAt !== "string" ||
    typeof approval.approvedBy !== "string" ||
    !Array.isArray(approval.acknowledgedDiscrepancyIds)
  ) {
    return "The approval record is missing required manifest, snapshot, owner or environment evidence.";
  }
  return null;
}

function normalizeSnapshot(
  input: MoneyImportSourceSnapshot,
): ApplicationResult<MoneyImportSourceSnapshot> {
  try {
    return applicationSuccess(createMoneyImportSnapshot(input));
  } catch (error) {
    return applicationFailure(
      error instanceof Error
        ? error.message
        : "The workbook snapshot is not valid.",
      "validation",
    );
  }
}

function normalizeCutover(
  raw: MoneyImportCutover,
): ApplicationResult<MoneyImportCutover> {
  const parsed = parseMoneyImportCutover(raw);
  if (!parsed.ok) {
    return applicationFailure(parsed.message, "validation");
  }
  return applicationSuccess(parsed.value);
}

function resolveNow(...values: Array<Date | undefined>): Date | null {
  const candidate = values.find((value) => value instanceof Date) ?? new Date();
  return Number.isNaN(candidate.getTime()) ? null : candidate;
}

function lastDayOfMonth(month: string): string {
  const [yearText, monthText] = month.split("-");
  const day = new Date(
    Date.UTC(Number(yearText), Number(monthText), 0),
  ).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

function readDateFromRaw(
  raw: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readRange(
  snapshot: MoneyImportSourceSnapshot,
  cutover: MoneyImportCutover,
): Readonly<{ startDate: string; endDate: string }> {
  const monthStart = `${snapshot.month}-01`;
  const monthEnd = lastDayOfMonth(snapshot.month);
  const dates = snapshot.rows
    .map((row) =>
      readDateFromRaw(row.raw, ["date", "bookingDate", "dueDate", "localDate"]),
    )
    .filter((value): value is string => value !== null);
  const startDate = [monthStart, cutover.date, ...dates]
    .sort()
    .at(0) ?? monthStart;
  return { startDate, endDate: monthEnd };
}

async function loadTarget(
  actor: AuthenticatedActor,
  deps: NovemberImportDependencies,
  snapshot: MoneyImportSourceSnapshot,
  cutover: MoneyImportCutover,
  environment: string,
): Promise<ApplicationResult<MoneyImportTarget>> {
  const range = readRange(snapshot, cutover);
  const [movements, beforeMovements, obligations, coffeeVisits] =
    await Promise.all([
      deps.imports.listTargetMovements(actor, range),
      deps.imports.listTargetMovementsBefore(actor, cutover.date, 500),
      deps.imports.listTargetObligations(actor, range),
      deps.imports.listTargetCoffeeVisits(actor, range),
    ]);
  if (!movements.ok) {
    return applicationFailure("Unable to read target movements right now.", "unknown");
  }
  if (!beforeMovements.ok) {
    return applicationFailure(
      "Unable to read historical target movements right now.",
      "unknown",
    );
  }
  if (!obligations.ok) {
    return applicationFailure("Unable to read target obligations right now.", "unknown");
  }
  if (!coffeeVisits.ok) {
    return applicationFailure("Unable to read target coffee visits right now.", "unknown");
  }
  const mergedMovements = new Map<string, MoneyImportTargetMovement>();
  for (const movement of movements.value) {
    mergedMovements.set(movement.id, movement);
  }
  for (const movement of beforeMovements.value) {
    if (!mergedMovements.has(movement.id)) {
      mergedMovements.set(movement.id, movement);
    }
  }
  return applicationSuccess({
    ownerId: actor.userId,
    environment,
    movements: [...mergedMovements.values()].sort((left, right) => {
      if (left.bookingDate !== right.bookingDate) {
        return left.bookingDate < right.bookingDate ? -1 : 1;
      }
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    }),
    obligations: obligations.value,
    coffeeVisits: coffeeVisits.value,
  });
}

function buildManifest(
  snapshot: MoneyImportSourceSnapshot,
  target: MoneyImportTarget,
  cutover: MoneyImportCutover,
  openingStrategy: MoneyImportOpeningStrategy,
): ApplicationResult<MoneyImportManifest> {
  try {
    return applicationSuccess(
      buildMoneyImportManifest({
        snapshot,
        target,
        cutover,
        openingStrategy,
      }),
    );
  } catch (error) {
    return applicationFailure(
      error instanceof Error
        ? error.message
        : "Unable to build the import manifest.",
      "validation",
    );
  }
}

function approvalFailure(
  failure: Exclude<ReturnType<typeof validateMoneyImportApproval>, { ok: true }>,
): ApplicationResult<never> {
  return applicationFailure(failure.message, failure.code, failure.reason);
}

export async function freezeNovemberImportSnapshot(
  input: unknown,
  options: Readonly<{ now?: Date }> = {},
): Promise<ApplicationResult<FrozenNovemberImportSnapshot>> {
  try {
    const snapshot = createMoneyImportSnapshot(input);
    const now = options.now ?? new Date();
    if (Number.isNaN(now.getTime())) {
      return applicationFailure("Current time is invalid.");
    }
    return applicationSuccess({
      snapshot,
      snapshotDigest: snapshotDigestOf(snapshot),
      frozenAt: now.toISOString(),
    });
  } catch (error) {
    return applicationFailure(
      error instanceof Error ? error.message : "The workbook snapshot is not valid.",
      "validation",
    );
  }
}

/** Build an exact, read-only manifest. No repository write is attempted. */
export async function previewNovemberImport(
  actor: AuthenticatedActor,
  deps: NovemberImportDependencies,
  request: NovemberImportPreviewRequest,
  options: Readonly<{ now?: Date }> = {},
): Promise<ApplicationResult<NovemberImportPreviewOutcome>> {
  const now = resolveNow(options.now, request.now);
  if (!now) return applicationFailure("Current time is invalid.");
  const scope = scopeFailure(actor, request.target, request.expectedEnvironment);
  if (scope) return scope;

  const normalizedSnapshot = normalizeSnapshot(request.snapshot);
  if (!normalizedSnapshot.ok) return normalizedSnapshot;
  const snapshot = normalizedSnapshot.data;
  const cutover = normalizeCutover(request.cutover);
  if (!cutover.ok) return cutover;
  const openingStrategy =
    request.openingStrategy ?? "verified_cutover_opening";
  if (!isMoneyImportOpeningStrategy(openingStrategy)) {
    return applicationFailure("Choose a supported opening strategy.", "validation");
  }

  const snapshotDigest = snapshotDigestOf(snapshot);
  const target = await loadTarget(
    actor,
    deps,
    snapshot,
    cutover.data,
    request.expectedEnvironment,
  );
  if (!target.ok) return target;
  const manifest = buildManifest(
    snapshot,
    target.data,
    cutover.data,
    openingStrategy,
  );
  if (!manifest.ok) return manifest;
  const frozenManifest = withSnapshotDigest(manifest.data, snapshotDigest);
  return applicationSuccess({
    manifest: frozenManifest,
    manifestDigest: manifestDigestOf(frozenManifest),
    snapshotDigest,
    readOnly: true,
  });
}

async function preflightPeriod(
  actor: AuthenticatedActor,
  deps: NovemberImportDependencies,
  manifest: MoneyImportManifest,
): Promise<ApplicationResult<PeriodPreflight>> {
  if (manifest.period.opening.amountMinor === null) {
    return applicationFailure(
      "The import opening is unknown; no Money period can be created.",
      "conflict",
    );
  }
  const tracking = await deps.periods.findTracking(actor);
  if (!tracking.ok) {
    return applicationFailure("Unable to inspect the tracking period right now.", "unknown");
  }
  if (tracking.value) {
    const period = tracking.value;
    if (
      period.startDate !== manifest.period.startDate ||
      period.endDate !== manifest.period.endDate ||
      period.timezone !== manifest.period.timezone
    ) {
      return applicationFailure(
        "An existing tracking period has different dates or timezone. Import cannot replace it.",
        "conflict",
      );
    }
    if (!period.openingMovementId) {
      return applicationFailure(
        "The existing tracking period has no opening record. Resolve it before importing.",
        "conflict",
      );
    }
    const opening = await deps.periods.getOpening(actor, period.openingMovementId);
    if (!opening.ok) {
      return applicationFailure("Unable to read the existing opening right now.", "unknown");
    }
    if (
      !opening.value ||
      opening.value.amountMinor !== manifest.period.opening.amountMinor
    ) {
      return applicationFailure(
        "The existing period opening differs from the approved import opening. Resolve it before importing.",
        "conflict",
      );
    }
    return applicationSuccess({ kind: "reuse", periodId: period.id });
  }

  const overlapping = await deps.periods.findOverlapping(actor, {
    startDate: manifest.period.startDate,
    endDate: manifest.period.endDate,
  });
  if (!overlapping.ok) {
    return applicationFailure("Unable to inspect existing periods right now.", "unknown");
  }
  if (overlapping.value.length > 0) {
    return applicationFailure(
      "A different Money period already covers the import dates. Import cannot create a second period.",
      "conflict",
    );
  }
  return applicationSuccess({ kind: "create" });
}

async function ensurePeriod(
  actor: AuthenticatedActor,
  deps: NovemberImportDependencies,
  manifest: MoneyImportManifest,
  now: Date,
): Promise<ApplicationResult<string>> {
  const preflight = await preflightPeriod(actor, deps, manifest);
  if (!preflight.ok) return applicationFailure(preflight.errorMessage, preflight.code);
  if (preflight.data.kind === "reuse") return applicationSuccess(preflight.data.periodId);

  const opening = manifest.period.opening;
  if (opening.amountMinor === null) {
    return applicationFailure("The import opening is unknown.", "conflict");
  }
  const created = await createMoneyPeriod(
    actor,
    deps.periods,
    {
      startDate: manifest.period.startDate,
      endDate: manifest.period.endDate,
      timezone: manifest.period.timezone,
      activeDate: manifest.period.activeDate,
      opening: {
        amountMinor: opening.amountMinor,
        source: "verified_source",
        cutoffDate: opening.cutoffDate,
        evidence: opening.evidence,
        note: null,
      },
      settings: {},
    },
    { now, surface: "web" },
  );
  if (!created.ok) {
    return applicationFailure(
      created.errorMessage,
      created.code ?? "unknown",
      created.reason,
    );
  }
  return applicationSuccess(created.data.period.id);
}

function cashCandidate(entry: MoneyImportCandidate): boolean {
  return (
    entry.classification === "income" ||
    entry.classification === "expense" ||
    entry.classification === "savings_transfer" ||
    entry.classification === "reconciliation_adjustment"
  );
}

function sortedCandidates(
  manifest: MoneyImportManifest,
): readonly MoneyImportCandidate[] {
  return [...manifest.candidates].sort((left, right) => {
    if (left.sheet !== right.sheet) return left.sheet < right.sheet ? -1 : 1;
    return left.sourceRowId < right.sourceRowId ? -1 : left.sourceRowId > right.sourceRowId ? 1 : 0;
  });
}

function appliedCountsFor(
  manifest: MoneyImportManifest,
  openingApplied: boolean,
): MoneyImportAppliedCounts {
  let ledgerInserted = 0;
  let ledgerLinked = 0;
  let ledgerAlreadyApplied = 0;
  let coffeeVisitsLinked = 0;
  let paidBillsLinked = 0;
  let unpaidBillsMetadata = 0;
  let skippedRows = 0;
  for (const entry of manifest.candidates) {
    if (entry.action === "skip") skippedRows += 1;
    if (cashCandidate(entry)) {
      if (entry.action === "insert") ledgerInserted += 1;
      else if (entry.action === "link") ledgerLinked += 1;
      else if (entry.action === "skip" && entry.reason === "already_applied") {
        ledgerAlreadyApplied += 1;
      }
    }
    if (entry.classification === "coffee_link" && entry.coffeeVisit) {
      if (entry.action === "link" || entry.action === "skip") coffeeVisitsLinked += 1;
    }
    if (entry.classification === "bill_link" && entry.bill) {
      if (entry.bill.paid) {
        if (entry.action === "link") paidBillsLinked += 1;
      } else {
        unpaidBillsMetadata += 1;
      }
    }
  }
  return {
    totalSourceRows: manifest.candidates.length,
    ledgerInserted,
    ledgerLinked,
    ledgerAlreadyApplied,
    openingApplied,
    coffeeVisitsLinked,
    paidBillsLinked,
    unpaidBillsMetadata,
    skippedRows,
  };
}

type PostCheck = Readonly<{
  reconciliation: MoneyImportPostReconciliation;
  counts: MoneyImportAppliedCounts;
  complete: boolean;
  periodId: string;
}>;

async function postReconcile(input: Readonly<{
  actor: AuthenticatedActor;
  deps: NovemberImportDependencies;
  manifest: MoneyImportManifest;
  periodId: string;
  movementIdsBySourceRowId: ReadonlyMap<string, string>;
  now: Date;
}>): Promise<ApplicationResult<PostCheck>> {
  const { actor, deps, manifest, periodId, movementIdsBySourceRowId, now } = input;
  const discrepancies: Array<{
    code: string;
    message: string;
    sourceRowIds: readonly string[];
  }> = [];
  const expected: Array<{
    candidate: MoneyImportCandidate;
    key: string;
  }> = [];
  const expectedByKey = new Map<string, MoneyImportCandidate[]>();
  for (const entry of manifest.candidates) {
    if (!cashCandidate(entry) || !entry.countsTowardCashEquation) continue;
    if (entry.action === "conflict") {
      discrepancies.push({
        code: "candidate_conflict",
        message: "An unapproved candidate conflict reached post reconciliation.",
        sourceRowIds: [entry.sourceRowId],
      });
      continue;
    }
    let key: string | null = null;
    if (entry.action === "link") {
      key = entry.targetMovementIdempotencyKey;
      if (!key) {
        discrepancies.push({
          code: "missing_link_key",
          message: "A linked movement has no stable target key.",
          sourceRowIds: [entry.sourceRowId],
        });
        continue;
      }
    } else {
      key = moneyImportMovementKey(manifest.snapshotId, entry.sourceRowId);
    }
    expected.push({ candidate: entry, key });
    const queue = expectedByKey.get(key) ?? [];
    queue.push(entry);
    expectedByKey.set(key, queue);
  }
  for (const [key, entries] of expectedByKey) {
    if (entries.length < 2) continue;
    discrepancies.push({
      code: "duplicate_target_claim",
      message:
        "More than one expected candidate resolves to the same target movement key.",
      sourceRowIds: entries.map((entry) => entry.sourceRowId),
    });
    void key;
  }

  const readback = await deps.imports.listMovementsByKeys(actor, [
    ...expectedByKey.keys(),
  ]);
  if (!readback.ok) {
    return applicationFailure(
      "Unable to verify imported movements right now.",
      "unknown",
    );
  }
  const rowsByKey = new Map<string, MoneyImportTargetMovement[]>();
  for (const row of readback.value) {
    const queue = rowsByKey.get(row.idempotencyKey) ?? [];
    queue.push(row);
    rowsByKey.set(row.idempotencyKey, queue);
  }
  for (const entry of expected) {
    const rows = rowsByKey.get(entry.key) ?? [];
    if (rows.length === 0) {
      discrepancies.push({
        code: "missing_movement",
        message: "A planned movement is missing after apply.",
        sourceRowIds: [entry.candidate.sourceRowId],
      });
      continue;
    }
    if (rows.length > 1) {
      discrepancies.push({
        code: "duplicate_movement",
        message: "A planned movement has more than one row with its stable key.",
        sourceRowIds: [entry.candidate.sourceRowId],
      });
      continue;
    }
    const row = rows[0];
    if (
      row.kind !== entry.candidate.kind ||
      row.direction !== entry.candidate.direction ||
      row.amountMinor !== entry.candidate.amountMinor ||
      row.bookingDate !== entry.candidate.bookingDate
    ) {
      discrepancies.push({
        code: "movement_mismatch",
        message: "A stored movement does not match the approved source values.",
        sourceRowIds: [entry.candidate.sourceRowId],
      });
      continue;
    }
    if (entry.candidate.action === "link") {
      if (
        row.category !== entry.candidate.category ||
        row.note !== entry.candidate.note ||
        row.merchant !== entry.candidate.merchant
      ) {
        discrepancies.push({
          code: "linked_movement_mismatch",
          message:
            "A linked movement classification or descriptive fields changed after approval.",
          sourceRowIds: [entry.candidate.sourceRowId],
        });
        continue;
      }
      if (
        entry.candidate.targetMovementId !== null &&
        row.id !== entry.candidate.targetMovementId
      ) {
        discrepancies.push({
          code: "linked_movement_mismatch",
          message: "A linked movement resolved to a different target row.",
          sourceRowIds: [entry.candidate.sourceRowId],
        });
        continue;
      }
    }
  }

  const period = await deps.periods.findById(actor, periodId);
  if (!period.ok) {
    return applicationFailure("Unable to verify the period opening right now.", "unknown");
  }
  if (!period.value || !period.value.openingMovementId) {
    discrepancies.push({
      code: "opening_mismatch",
      message: "The period opening does not match the approved import opening.",
      sourceRowIds: [],
    });
  }
  const opening = period.value?.openingMovementId
    ? await deps.periods.getOpening(actor, period.value.openingMovementId)
    : null;
  if (opening && !opening.ok) {
    return applicationFailure("Unable to verify the period opening right now.", "unknown");
  }
  const openingAmountMinor = opening?.ok ? opening.value?.amountMinor ?? null : null;
  if (
    openingAmountMinor === null ||
    manifest.period.opening.amountMinor === null ||
    openingAmountMinor !== manifest.period.opening.amountMinor
  ) {
    discrepancies.push({
      code: "opening_mismatch",
      message: "The period opening does not match the approved import opening.",
      sourceRowIds: [],
    });
  }

  // The closing is the canonical ledger aggregate for the whole period, not
  // just the rows this import planned. An unrelated movement must therefore
  // force review instead of being silently ignored.
  const aggregate = await deps.periods.sumLedgerByDirection(actor, {
    startDate: manifest.period.startDate,
    endDateInclusive: manifest.period.endDate,
  });
  if (!aggregate.ok) {
    return applicationFailure(
      "Unable to verify the canonical period ledger aggregate right now.",
      "unknown",
    );
  }
  if (aggregate.value.truncated) {
    discrepancies.push({
      code: "aggregate_truncated",
      message: "The canonical period ledger aggregate was truncated.",
      sourceRowIds: [],
    });
  }
  if (aggregate.value.recordCount !== expectedByKey.size) {
    discrepancies.push({
      code: "movement_count_mismatch",
      message:
        "The canonical period ledger count does not match the approved import movement count.",
      sourceRowIds: [],
    });
  }

  const recordedClosingMinor =
    openingAmountMinor === null
      ? null
      : openingAmountMinor +
        aggregate.value.inflowsMinor -
        aggregate.value.outflowsMinor;
  const expectedClosing = moneyImportCashEquation(manifest).expectedClosingMinor;
  const difference =
    recordedClosingMinor === null ? null : recordedClosingMinor - expectedClosing;
  if (difference !== null && difference !== 0) {
    discrepancies.push({
      code: "closing_difference",
      message: "The recorded imported closing differs from the approved manifest.",
      sourceRowIds: [],
    });
  }

  let coffeeVisitCount = 0;
  for (const entry of manifest.candidates) {
    if (entry.classification !== "coffee_link" || !entry.coffeeVisit) continue;
    if (entry.action === "conflict") continue;
    const visitKey = moneyImportCoffeeVisitKey(
      manifest.snapshotId,
      entry.sourceRowId,
    );
    const visit = await deps.coffee.findByVisitKey(actor, visitKey);
    if (!visit.ok) {
      return applicationFailure("Unable to verify coffee visits right now.", "unknown");
    }
    if (!visit.value) {
      discrepancies.push({
        code: "missing_coffee_visit",
        message: "A planned coffee visit is missing after apply.",
        sourceRowIds: [entry.sourceRowId],
      });
    } else {
      const expectedExpenseId =
        (entry.coffeeVisit.linkedSourceRowId
          ? movementIdsBySourceRowId.get(entry.coffeeVisit.linkedSourceRowId)
          : undefined) ?? entry.coffeeVisit.targetMovementId;
      const actualExpenseIds = visit.value.lines
        .map((line) => line.expenseId)
        .sort();
      if (
        visit.value.localDate !== entry.coffeeVisit.localDate ||
        (expectedExpenseId !== null &&
          (actualExpenseIds.length !== 1 ||
            actualExpenseIds[0] !== expectedExpenseId))
      ) {
        discrepancies.push({
          code: "coffee_visit_mismatch",
          message:
            "A stored coffee visit does not match the approved coffee date or linked purchase.",
          sourceRowIds: [entry.sourceRowId],
        });
      } else {
        coffeeVisitCount += 1;
      }
    }
  }

  const complete = discrepancies.length === 0 && manifest.blockers.length === 0;
  const reconciliation: MoneyImportPostReconciliation = Object.freeze({
    complete,
    periodId,
    expectedClosingMinor: expectedClosing,
    recordedClosingMinor,
    differenceMinor: difference,
    openingAmountMinor,
    movementCount: aggregate.value.recordCount,
    coffeeVisitCount,
    discrepancies: Object.freeze(discrepancies.map((entry) => Object.freeze(entry))),
    checkedAt: now.toISOString(),
    statusReason: complete ? null : "post_reconciliation_mismatch",
  });
  return applicationSuccess({
    reconciliation,
    counts: appliedCountsFor(manifest, true),
    complete,
    periodId,
  });
}

async function executeApply(input: Readonly<{
  actor: AuthenticatedActor;
  deps: NovemberImportDependencies;
  receipt: MoneyImportAdoptionRecord;
  now: Date;
}>): Promise<ApplicationResult<NovemberImportApplyOutcome>> {
  const { actor, deps, receipt, now } = input;
  try {
    const periodIdResult = await ensurePeriod(
      actor,
      deps,
      receipt.manifest,
      now,
    );
    if (!periodIdResult.ok) return periodIdResult;
    const periodId = periodIdResult.data;
    const movementIdsBySourceRowId = new Map<string, string>();
    const candidates = sortedCandidates(receipt.manifest);

    for (const entry of candidates) {
      if (!cashCandidate(entry)) continue;
      if (entry.action === "insert") {
        const created = await createMovement(
          actor,
          deps.movements,
          {
            kind: entry.kind,
            direction: entry.direction,
            amountMinor: entry.amountMinor,
            category: entry.category,
            note: entry.note,
            merchant: entry.merchant,
            needVsWant: entry.needVsWant,
            purpose: entry.purpose,
            countsInDaily: entry.countsInDaily,
            bookingDate: entry.bookingDate,
            occurredAt: null,
            idempotencyKey: moneyImportMovementKey(
              receipt.snapshotId,
              entry.sourceRowId,
            ),
          },
          { periods: deps.periods },
        );
        if (!created.ok) {
          return applicationFailure(
            "The approved import could not complete. Retry the same approved import to resume.",
            created.code ?? "unknown",
            "apply_incomplete",
          );
        }
        movementIdsBySourceRowId.set(entry.sourceRowId, created.data.movement.id);
      } else if (entry.targetMovementId) {
        movementIdsBySourceRowId.set(entry.sourceRowId, entry.targetMovementId);
      }
    }

    for (const entry of candidates) {
      if (entry.classification !== "coffee_link" || !entry.coffeeVisit) continue;
      if (entry.action === "conflict" || entry.action === "skip") continue;
      const linkedId =
        (entry.coffeeVisit.linkedSourceRowId
          ? movementIdsBySourceRowId.get(entry.coffeeVisit.linkedSourceRowId)
          : undefined) ??
        entry.coffeeVisit.targetMovementId ??
        entry.targetMovementId;
      if (!linkedId) {
        return applicationFailure(
          "The approved import could not link a coffee visit. Retry after inspecting the receipt.",
          "conflict",
          "apply_incomplete",
        );
      }
      const visit = await recordMoneyCoffeeVisit(
        actor,
        { expenses: deps.expenses, coffee: deps.coffee },
        {
          visitKey: moneyImportCoffeeVisitKey(
            receipt.snapshotId,
            entry.sourceRowId,
          ),
          localDate: entry.coffeeVisit.localDate,
          timezone: receipt.manifest.period.timezone,
          expenseIds: [linkedId],
          note: entry.coffeeVisit.note,
        },
        { now },
      );
      if (!visit.ok) {
        return applicationFailure(
          "The approved import could not record a coffee visit. Retry the same approved import to resume.",
          visit.code ?? "unknown",
          "apply_incomplete",
        );
      }
    }

    const post = await postReconcile({
      actor,
      deps,
      manifest: receipt.manifest,
      periodId,
      movementIdsBySourceRowId,
      now,
    });
    if (!post.ok) return post;

    const status: MoneyImportAdoptionStatus = post.data.complete
      ? "adopted"
      : "review_needed";
    const completed: MoneyImportAdoptionRecord = Object.freeze({
      ...receipt,
      status,
      appliedCounts: post.data.counts,
      postReconciliation: post.data.reconciliation,
      updatedAt: now.toISOString(),
      appliedAt: now.toISOString(),
    });
    const saved = post.data.complete
      ? await deps.imports.completeAdoption(actor, completed)
      : await deps.imports.markAdoptionReview(actor, completed);
    if (!saved.ok) {
      return applicationFailure(
        "The import finished but its adoption receipt could not be updated. Retry to repair the receipt.",
        saved.error.code,
        "apply_incomplete",
      );
    }
    return applicationSuccess({
      status: saved.value.status,
      replay: false,
      receipt: saved.value,
      manifestDigest: saved.value.manifestDigest,
      snapshotDigest: saved.value.snapshotDigest,
      periodId: post.data.periodId,
      appliedCounts: saved.value.appliedCounts,
      postReconciliation: saved.value.postReconciliation,
    });
  } catch {
    return applicationFailure(
      "The approved import could not complete. Retry the same approved import to resume.",
      "unknown",
      "apply_incomplete",
    );
  }
}

function replayOutcome(
  receipt: MoneyImportAdoptionRecord,
): NovemberImportApplyOutcome {
  return {
    status: receipt.status,
    replay: true,
    receipt,
    manifestDigest: receipt.manifestDigest,
    snapshotDigest: receipt.snapshotDigest,
    periodId: receipt.postReconciliation?.periodId ?? null,
    appliedCounts: receipt.appliedCounts,
    postReconciliation: receipt.postReconciliation,
  };
}

async function existingReceiptOutcome(
  actor: AuthenticatedActor,
  deps: NovemberImportDependencies,
  receipt: MoneyImportAdoptionRecord,
  approval: NovemberImportApplyRequest["approval"],
  requestSnapshotDigest: string,
  expectedEnvironment: string,
  now: Date,
): Promise<ApplicationResult<NovemberImportApplyOutcome>> {
  if (receipt.manifestDigest !== approval.manifestDigest) {
    return applicationFailure(
      "This snapshot was already imported with a different approved manifest.",
      "conflict",
      "manifest_digest_mismatch",
    );
  }
  if (receipt.snapshotDigest !== requestSnapshotDigest) {
    return applicationFailure(
      "This snapshot identity already has a different frozen source snapshot.",
      "conflict",
      "snapshot_digest_mismatch",
    );
  }
  if (receipt.targetEnvironment !== expectedEnvironment) {
    return applicationFailure(
      "This snapshot was imported for a different target environment.",
      "conflict",
      "environment_mismatch",
    );
  }
  const storedSnapshotDigest = snapshotDigestOf(receipt.snapshot);
  const storedManifestDigest = manifestDigestOf(receipt.manifest);
  if (
    storedSnapshotDigest !== receipt.snapshotDigest ||
    storedManifestDigest !== receipt.manifestDigest
  ) {
    return applicationFailure(
      "The stored adoption evidence does not match its recorded digests.",
      "conflict",
      "receipt_digest_mismatch",
    );
  }
  const validation = validateMoneyImportApproval(
    receipt.manifest,
    receipt.manifestDigest,
    approval,
    {
      ownerId: actor.userId,
      environment: expectedEnvironment,
      snapshotDigest: receipt.snapshotDigest,
    },
  );
  if (!validation.ok) return approvalFailure(validation);
  if (receipt.status === "applying") {
    const currentTarget = await loadTarget(
      actor,
      deps,
      receipt.snapshot,
      receipt.manifest.cutover,
      expectedEnvironment,
    );
    if (!currentTarget.ok) return currentTarget;
    const drift = moneyImportTargetDrift(receipt.manifest, currentTarget.data);
    if (!drift.ok) {
      return applicationFailure(
        "The owner-scoped target changed after the approved manifest. Resolve the drift and retry the same approved import.",
        "conflict",
        "target_drift",
      );
    }
    return executeApply({ actor, deps, receipt, now });
  }
  return applicationSuccess(replayOutcome(receipt));
}

/** Apply the exact approved manifest; a replay performs no writes. */
export async function applyNovemberImport(
  actor: AuthenticatedActor,
  deps: NovemberImportDependencies,
  request: NovemberImportApplyRequest,
  options: Readonly<{ now?: Date }> = {},
): Promise<ApplicationResult<NovemberImportApplyOutcome>> {
  const now = resolveNow(options.now, request.now);
  if (!now) return applicationFailure("Current time is invalid.");
  const scope = scopeFailure(actor, request.target, request.expectedEnvironment);
  if (scope) return scope;
  const approvalProblem = approvalShapeFailure(request.approval);
  if (approvalProblem) return applicationFailure(approvalProblem, "validation");

  const normalizedSnapshot = normalizeSnapshot(request.snapshot);
  if (!normalizedSnapshot.ok) return normalizedSnapshot;
  const snapshot = normalizedSnapshot.data;
  const snapshotDigest = snapshotDigestOf(snapshot);

  // Receipt lookup happens before any target re-derivation. After a successful
  // apply the target already contains the import keys, so recomputing a fresh
  // manifest would produce a different digest and break approved replay.
  const existing = await deps.imports.getAdoption(actor, snapshot.snapshotId);
  if (!existing.ok) {
    return applicationFailure("Unable to read the adoption receipt right now.", "unknown");
  }
  if (existing.value) {
    return existingReceiptOutcome(
      actor,
      deps,
      existing.value,
      request.approval,
      snapshotDigest,
      request.expectedEnvironment,
      now,
    );
  }

  const cutover = normalizeCutover(request.cutover);
  if (!cutover.ok) return cutover;
  const openingStrategy =
    request.openingStrategy ?? "verified_cutover_opening";
  if (!isMoneyImportOpeningStrategy(openingStrategy)) {
    return applicationFailure("Choose a supported opening strategy.", "validation");
  }
  const target = await loadTarget(
    actor,
    deps,
    snapshot,
    cutover.data,
    request.expectedEnvironment,
  );
  if (!target.ok) return target;
  const manifest = buildManifest(
    snapshot,
    target.data,
    cutover.data,
    openingStrategy,
  );
  if (!manifest.ok) return manifest;
  const frozenManifest = withSnapshotDigest(manifest.data, snapshotDigest);
  const manifestDigest = manifestDigestOf(frozenManifest);
  const validation = validateMoneyImportApproval(
    frozenManifest,
    manifestDigest,
    request.approval,
    {
      ownerId: actor.userId,
      environment: request.expectedEnvironment,
      snapshotDigest,
    },
  );
  if (!validation.ok) return approvalFailure(validation);

  const preflight = await preflightPeriod(actor, deps, frozenManifest);
  if (!preflight.ok) {
    return applicationFailure(preflight.errorMessage, preflight.code);
  }

  const nowIso = now.toISOString();
  const receiptFields: MoneyImportAdoptionFields = {
    snapshotId: snapshot.snapshotId,
    snapshotDigest,
    manifestDigest,
    sourceIdentity: frozenManifest.sourceIdentity,
    targetEnvironment: request.expectedEnvironment,
    openingStrategy,
    cutoverDate: cutover.data.date,
    status: "applying",
    snapshot,
    manifest: frozenManifest,
    approval: request.approval,
    appliedCounts: null,
    postReconciliation: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    appliedAt: null,
  };
  const begun = await deps.imports.beginAdoption(actor, receiptFields);
  if (!begun.ok) {
    if (begun.error.code === "conflict") {
      const raced = await deps.imports.getAdoption(actor, snapshot.snapshotId);
      if (raced.ok && raced.value) {
        return existingReceiptOutcome(
          actor,
          deps,
          raced.value,
          request.approval,
          snapshotDigest,
          request.expectedEnvironment,
          now,
        );
      }
    }
    return applicationFailure(
      "Unable to begin the adoption receipt right now.",
      begun.error.code,
    );
  }
  return executeApply({ actor, deps, receipt: begun.value, now });
}

export async function getNovemberImportStatus(
  actor: AuthenticatedActor,
  deps: Pick<NovemberImportDependencies, "imports">,
  snapshotId: string,
): Promise<ApplicationResult<NovemberImportStatusOutcome>> {
  if (typeof snapshotId !== "string" || !snapshotId.trim()) {
    return applicationFailure("A snapshot id is required.", "validation");
  }
  const receipt = await deps.imports.getAdoption(actor, snapshotId.trim());
  if (!receipt.ok) {
    return applicationFailure("Unable to read the adoption receipt right now.", "unknown");
  }
  if (!receipt.value) {
    return applicationFailure("No import adoption exists for this snapshot.", "notFound");
  }
  return applicationSuccess({
    snapshotId: receipt.value.snapshotId,
    status: receipt.value.status,
    manifestDigest: receipt.value.manifestDigest,
    snapshotDigest: receipt.value.snapshotDigest,
    openingStrategy: receipt.value.openingStrategy,
    cutoverDate: receipt.value.cutoverDate,
    appliedCounts: receipt.value.appliedCounts,
    postReconciliation: receipt.value.postReconciliation,
    appliedAt: receipt.value.appliedAt,
    updatedAt: receipt.value.updatedAt,
  });
}
