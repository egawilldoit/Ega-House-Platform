import assert from "node:assert/strict";
import test from "node:test";

import {
  createMoneyImportSnapshot,
  type MoneyImportApproval,
  type MoneyImportCutover,
  type MoneyImportSourceSnapshot,
} from "@ega/domain/money-import";

import {
  applyNovemberImport,
  freezeNovemberImportSnapshot,
  getNovemberImportStatus,
  previewNovemberImport,
  type NovemberImportApplyRequest,
  type NovemberImportPreviewOutcome,
  type NovemberImportPreviewRequest,
} from "../src/money/import";
import {
  NOVEMBER_CUTOVER,
  NOVEMBER_SNAPSHOT_ID,
  novemberWorkbookInput,
} from "../../domain/test/fixtures/money-001-november";
import {
  IMPORT_ACTOR,
  IMPORT_ENVIRONMENT,
  OTHER_ACTOR,
  createImportHarness,
  type ImportHarness,
} from "./money-import-fakes";

const CUTOVER: MoneyImportCutover = {
  date: NOVEMBER_CUTOVER.date,
  reportedBalanceMinor: NOVEMBER_CUTOVER.reportedBalanceMinor,
  verified: NOVEMBER_CUTOVER.verified,
  evidenceRef: NOVEMBER_CUTOVER.evidenceRef,
  uncoveredDates: [...NOVEMBER_CUTOVER.uncoveredDates],
};

function snapshot(): MoneyImportSourceSnapshot {
  return createMoneyImportSnapshot(novemberWorkbookInput());
}

function previewRequest(
  snapshotValue: MoneyImportSourceSnapshot = snapshot(),
  cutover: MoneyImportCutover = CUTOVER,
): NovemberImportPreviewRequest {
  return {
    snapshot: snapshotValue,
    target: { ownerId: IMPORT_ACTOR.userId, environment: IMPORT_ENVIRONMENT },
    cutover,
    openingStrategy: "verified_cutover_opening",
    expectedEnvironment: IMPORT_ENVIRONMENT,
  };
}

function approvalFrom(
  preview: NovemberImportPreviewOutcome,
  overrides: Partial<MoneyImportApproval> = {},
): MoneyImportApproval {
  return {
    status: "approved",
    manifestDigest: preview.manifestDigest,
    snapshotDigest: preview.snapshotDigest,
    ownerId: IMPORT_ACTOR.userId,
    environment: IMPORT_ENVIRONMENT,
    approvedAt: "2026-11-23T10:00:00.000Z",
    approvedBy: IMPORT_ACTOR.userId,
    acknowledgedDiscrepancyIds: preview.manifest.discrepancies
      .filter((entry) => entry.severity === "acknowledged")
      .map((entry) => entry.id),
    ...overrides,
  };
}

function applyRequest(
  snapshotValue: MoneyImportSourceSnapshot,
  approval: MoneyImportApproval,
  cutover: MoneyImportCutover = CUTOVER,
): NovemberImportApplyRequest {
  return {
    snapshot: snapshotValue,
    approval,
    target: { ownerId: IMPORT_ACTOR.userId, environment: IMPORT_ENVIRONMENT },
    cutover,
    openingStrategy: "verified_cutover_opening",
    expectedEnvironment: IMPORT_ENVIRONMENT,
  };
}

function writeCounts(harness: ImportHarness) {
  return { ...harness.state.writes };
}

test("T23 preview is deterministic, read-only and never persists a snapshot or movement", async () => {
  const harness = createImportHarness();
  const source = snapshot();
  const before = structuredClone(source);
  const request = previewRequest(source);

  const first = await previewNovemberImport(IMPORT_ACTOR, harness.deps, request);
  const second = await previewNovemberImport(IMPORT_ACTOR, harness.deps, request);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.data.readOnly, true);
  assert.equal(first.data.manifestDigest, second.data.manifestDigest);
  assert.equal(first.data.snapshotDigest, second.data.snapshotDigest);
  assert.equal(first.data.manifest.summary.cashEquation.expectedClosingMinor, 5_875);
  assert.deepEqual(source, before);
  assert.deepEqual(writeCounts(harness), {
    adoption: 0,
    movement: 0,
    period: 0,
    visit: 0,
  });
  assert.equal(harness.state.adoptions.size, 0);
  assert.equal(harness.state.movements.length, 0);
  assert.equal(harness.state.periods.length, 0);
  assert.equal(harness.state.visits.length, 0);
});

test("synthetic apply adopts exactly 5875 centimes once, links coffee/bills, and replays without writes", async () => {
  const harness = createImportHarness();
  const source = snapshot();
  const preview = await previewNovemberImport(IMPORT_ACTOR, harness.deps, previewRequest(source));
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  const approval = approvalFrom(preview.data);
  const request = applyRequest(source, approval);

  const applied = await applyNovemberImport(IMPORT_ACTOR, harness.deps, request);
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.data.status, "adopted");
  assert.equal(applied.data.replay, false);
  assert.equal(applied.data.postReconciliation?.complete, true);
  assert.equal(applied.data.postReconciliation?.expectedClosingMinor, 5_875);
  assert.equal(applied.data.postReconciliation?.recordedClosingMinor, 5_875);
  assert.equal(applied.data.postReconciliation?.differenceMinor, 0);
  assert.equal(applied.data.postReconciliation?.movementCount, 6);
  assert.equal(applied.data.postReconciliation?.coffeeVisitCount, 1);
  assert.equal(applied.data.appliedCounts?.ledgerInserted, 6);
  assert.equal(applied.data.appliedCounts?.openingApplied, true);
  assert.equal(applied.data.appliedCounts?.coffeeVisitsLinked, 1);
  assert.equal(applied.data.appliedCounts?.paidBillsLinked, 1);
  assert.equal(applied.data.appliedCounts?.unpaidBillsMetadata, 1);

  // T25: one opening row, no pre-cutover ledger replay, six post-cutover rows.
  assert.equal(harness.state.periods.length, 1);
  assert.equal(harness.state.periods[0]!.startDate, "2026-11-01");
  assert.equal(harness.state.periods[0]!.endDate, "2026-11-30");
  const openingRows = harness.state.movements.filter((row) => row.kind === "opening");
  assert.equal(openingRows.length, 1);
  assert.equal(openingRows[0]!.amountMinor, 10_000);
  const cashRows = harness.state.movements.filter((row) => row.kind !== "opening");
  assert.equal(cashRows.length, 6);
  assert.equal(cashRows.filter((row) => row.bookingDate < "2026-11-01").length, 0);
  const signedClosing =
    openingRows[0]!.amountMinor +
    cashRows.reduce(
      (total, row) => total + (row.direction === "in" ? row.amountMinor : -row.amountMinor),
      0,
    );
  assert.equal(signedClosing, 5_875);

  // T22 duplicate views: one coffee cash row, one visit, no bill cash row.
  assert.equal(harness.state.movements.filter((row) => row.category === "coffee").length, 1);
  assert.equal(harness.state.visits.length, 1);
  assert.equal(harness.state.visits[0]!.lines.length, 1);
  assert.equal(harness.state.movements.filter((row) => row.note === "Internet").length, 1);

  const statusA = await getNovemberImportStatus(IMPORT_ACTOR, harness.deps, NOVEMBER_SNAPSHOT_ID);
  assert.equal(statusA.ok, true);
  if (statusA.ok) assert.equal(statusA.data.status, "adopted");
  const statusB = await getNovemberImportStatus(OTHER_ACTOR, harness.deps, NOVEMBER_SNAPSHOT_ID);
  assert.equal(statusB.ok, false);
  if (!statusB.ok) assert.equal(statusB.code, "notFound");

  // After success the target contains import keys, so a fresh manifest would
  // legitimately produce already_applied candidates and another digest. Apply
  // must still replay the stored receipt because it checks the receipt first.
  const afterApplyPreview = await previewNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    previewRequest(source),
  );
  assert.equal(afterApplyPreview.ok, true);
  if (afterApplyPreview.ok) {
    assert.notEqual(afterApplyPreview.data.manifestDigest, preview.data.manifestDigest);
  }

  const writesBeforeReplay = writeCounts(harness);
  const movementsBeforeReplay = harness.state.movements.length;
  const replay = await applyNovemberImport(IMPORT_ACTOR, harness.deps, request);
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.data.replay, true);
  assert.equal(replay.data.status, "adopted");
  assert.deepEqual(writeCounts(harness), writesBeforeReplay);
  assert.equal(harness.state.movements.length, movementsBeforeReplay);
});

test("T24 a strong existing movement match links instead of inserting", async () => {
  const harness = createImportHarness();
  const existingL7 = harness.seedMovement({
    idempotencyKey: "target-existing-l7",
    kind: "expense",
    direction: "out",
    amountMinor: 500,
    category: "groceries",
    note: "Groceries",
    merchant: "Marjane",
    needVsWant: "need",
    purpose: "flexible",
    countsInDaily: true,
    bookingDate: "2026-11-06",
  });
  const source = snapshot();
  const preview = await previewNovemberImport(IMPORT_ACTOR, harness.deps, previewRequest(source));
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  const l7 = preview.data.manifest.candidates.find((entry) => entry.sourceRowId === "L7");
  assert.equal(l7?.action, "link");
  assert.equal(l7?.targetMovementId, existingL7.id);

  const applied = await applyNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    applyRequest(source, approvalFrom(preview.data)),
  );
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.data.status, "adopted");
  assert.equal(applied.data.postReconciliation?.recordedClosingMinor, 5_875);
  assert.equal(
    harness.state.movements.some(
      (row) => row.idempotencyKey === `mi-mv:${NOVEMBER_SNAPSHOT_ID}:L7`,
    ),
    false,
  );
  assert.equal(harness.state.movements.filter((row) => row.kind !== "opening").length, 6);
});

test("T24 ambiguous target matches block apply with zero writes", async () => {
  const harness = createImportHarness();
  const base = {
    kind: "expense" as const,
    direction: "out" as const,
    amountMinor: 500,
    category: "groceries" as const,
    note: "Groceries",
    merchant: "Marjane",
    needVsWant: "need" as const,
    purpose: "flexible" as const,
    countsInDaily: true,
    bookingDate: "2026-11-06",
  };
  harness.seedMovement({ ...base, idempotencyKey: "duplicate-l7-a" });
  harness.seedMovement({ ...base, idempotencyKey: "duplicate-l7-b" });
  const source = snapshot();
  const preview = await previewNovemberImport(IMPORT_ACTOR, harness.deps, previewRequest(source));
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.ok(preview.data.manifest.blockers.includes("ambiguous_existing_match"));
  const applied = await applyNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    applyRequest(source, approvalFrom(preview.data)),
  );
  assert.equal(applied.ok, false);
  if (!applied.ok) assert.equal(applied.code, "conflict");
  assert.deepEqual(writeCounts(harness), {
    adoption: 0,
    movement: 0,
    period: 0,
    visit: 0,
  });
});

test("partner owner and environment fail before any read/write side effect", async () => {
  const harness = createImportHarness();
  const validPreview = await previewNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    previewRequest(),
  );
  assert.equal(validPreview.ok, true);
  if (!validPreview.ok) return;

  const ownerPreview = await previewNovemberImport(IMPORT_ACTOR, harness.deps, {
    ...previewRequest(),
    target: { ownerId: OTHER_ACTOR.userId, environment: IMPORT_ENVIRONMENT },
  });
  assert.equal(ownerPreview.ok, false);
  if (!ownerPreview.ok) assert.equal(ownerPreview.code, "forbidden");

  const environmentPreview = await previewNovemberImport(IMPORT_ACTOR, harness.deps, {
    ...previewRequest(),
    target: { ownerId: IMPORT_ACTOR.userId, environment: "production" },
  });
  assert.equal(environmentPreview.ok, false);
  if (!environmentPreview.ok) assert.equal(environmentPreview.code, "forbidden");

  const ownerApply = await applyNovemberImport(IMPORT_ACTOR, harness.deps, {
    ...applyRequest(snapshot(), approvalFrom(validPreview.data)),
    target: { ownerId: OTHER_ACTOR.userId, environment: IMPORT_ENVIRONMENT },
  });
  assert.equal(ownerApply.ok, false);
  if (!ownerApply.ok) assert.equal(ownerApply.code, "forbidden");
  assert.deepEqual(writeCounts(harness), {
    adoption: 0,
    movement: 0,
    period: 0,
    visit: 0,
  });
});

test("T26 unapproved, modified or blocking manifests fail with zero writes", async () => {
  const harness = createImportHarness();
  const source = snapshot();
  const preview = await previewNovemberImport(IMPORT_ACTOR, harness.deps, previewRequest(source));
  assert.equal(preview.ok, true);
  if (!preview.ok) return;

  const unapproved = await applyNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    applyRequest(source, approvalFrom(preview.data, { status: "draft" as "approved" })),
  );
  assert.equal(unapproved.ok, false);
  if (!unapproved.ok) assert.equal(unapproved.code, "validation");

  const modified = await applyNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    applyRequest(source, approvalFrom(preview.data, { manifestDigest: "c".repeat(64) })),
  );
  assert.equal(modified.ok, false);
  if (!modified.ok) assert.equal(modified.code, "conflict");

  const blockingInput = novemberWorkbookInput();
  (blockingInput.rows as Array<Record<string, unknown>>).push({
    sourceRowId: "X1",
    sheet: "Ledger",
    rowIndex: 20,
    raw: { type: "mystery", date: "2026-11-10", amount: 1 },
  });
  const blockingSnapshot = createMoneyImportSnapshot(blockingInput);
  const blockingPreview = await previewNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    previewRequest(blockingSnapshot),
  );
  assert.equal(blockingPreview.ok, true);
  if (!blockingPreview.ok) return;
  assert.ok(blockingPreview.data.manifest.blockers.includes("unresolved_row"));
  const blockingApply = await applyNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    applyRequest(blockingSnapshot, approvalFrom(blockingPreview.data)),
  );
  assert.equal(blockingApply.ok, false);
  if (!blockingApply.ok) assert.equal(blockingApply.code, "conflict");

  assert.deepEqual(writeCounts(harness), {
    adoption: 0,
    movement: 0,
    period: 0,
    visit: 0,
  });
  assert.equal(harness.state.adoptions.size, 0);
});

test("T27 an interrupted apply leaves applying, resumes without duplicates, and replays", async () => {
  const harness = createImportHarness();
  const source = snapshot();
  const preview = await previewNovemberImport(IMPORT_ACTOR, harness.deps, previewRequest(source));
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  const request = applyRequest(source, approvalFrom(preview.data));

  harness.state.failMovementCreateAfter = 3;
  const interrupted = await applyNovemberImport(IMPORT_ACTOR, harness.deps, request);
  assert.equal(interrupted.ok, false);
  if (!interrupted.ok) assert.equal(interrupted.reason, "apply_incomplete");

  const applying = await getNovemberImportStatus(
    IMPORT_ACTOR,
    harness.deps,
    NOVEMBER_SNAPSHOT_ID,
  );
  assert.equal(applying.ok, true);
  if (applying.ok) assert.equal(applying.data.status, "applying");
  assert.equal(harness.state.periods.length, 1);
  assert.equal(
    harness.state.movements.filter((row) => row.idempotencyKey.startsWith("mi-mv:")).length,
    3,
  );

  // A fresh manifest would now block on this pre-cutover target movement. The
  // resume path must re-audit the target and reject the drift without writing.
  const lateRow = harness.seedMovement({
    idempotencyKey: "external-late-pre-cutover",
    kind: "income",
    direction: "in",
    amountMinor: 1,
    bookingDate: "2026-10-30",
    note: "late external row",
  });

  harness.state.failMovementCreateAfter = null;
  const writesBeforeDrift = writeCounts(harness);
  const drifted = await applyNovemberImport(IMPORT_ACTOR, harness.deps, request);
  assert.equal(drifted.ok, false);
  if (!drifted.ok) {
    assert.equal(drifted.code, "conflict");
    assert.equal(drifted.reason, "target_drift");
  }
  assert.deepEqual(writeCounts(harness), writesBeforeDrift);
  assert.equal(
    harness.state.movements.filter((row) => row.idempotencyKey.startsWith("mi-mv:")).length,
    3,
  );
  const stillApplying = await getNovemberImportStatus(
    IMPORT_ACTOR,
    harness.deps,
    NOVEMBER_SNAPSHOT_ID,
  );
  assert.equal(stillApplying.ok, true);
  if (stillApplying.ok) assert.equal(stillApplying.data.status, "applying");

  const lateIndex = harness.state.movements.findIndex(
    (row) => row.id === lateRow.id,
  );
  assert.notEqual(lateIndex, -1);
  harness.state.movements.splice(lateIndex, 1);

  const resumed = await applyNovemberImport(IMPORT_ACTOR, harness.deps, request);
  assert.equal(resumed.ok, true);
  if (!resumed.ok) return;
  assert.equal(resumed.data.status, "adopted");
  assert.equal(resumed.data.postReconciliation?.recordedClosingMinor, 5_875);
  assert.equal(
    harness.state.movements.filter((row) => row.idempotencyKey.startsWith("mi-mv:")).length,
    6,
  );
  assert.equal(harness.state.visits.length, 1);
  const importKeys = harness.state.movements
    .filter((row) => row.idempotencyKey.startsWith("mi-mv:"))
    .map((row) => row.idempotencyKey);
  assert.equal(new Set(importKeys).size, importKeys.length);

  const writesAfterResume = writeCounts(harness);
  const firstReplay = await applyNovemberImport(IMPORT_ACTOR, harness.deps, request);
  const secondReplay = await applyNovemberImport(IMPORT_ACTOR, harness.deps, request);
  assert.equal(firstReplay.ok, true);
  assert.equal(secondReplay.ok, true);
  if (firstReplay.ok) assert.equal(firstReplay.data.replay, true);
  if (secondReplay.ok) assert.equal(secondReplay.data.replay, true);
  assert.deepEqual(writeCounts(harness), writesAfterResume);
  assert.equal(
    harness.state.movements.filter((row) => row.idempotencyKey.startsWith("mi-mv:")).length,
    6,
  );
  assert.equal(harness.state.visits.length, 1);
  assert.equal(
    harness.state.movements.reduce(
      (total, row) =>
        total +
        (row.kind === "opening"
          ? row.amountMinor
          : row.idempotencyKey.startsWith("mi-mv:")
            ? row.direction === "in"
              ? row.amountMinor
              : -row.amountMinor
            : 0),
      0,
    ),
    5_875,
  );
});

test("T28 foreign-workbook originals are rejected and never mutated", async () => {
  const harness = createImportHarness();
  const input = novemberWorkbookInput();
  const rows = input.rows as Array<Record<string, unknown>>;
  const l3 = rows.find((row) => row.sourceRowId === "L3");
  assert.ok(l3);
  (l3.raw as Record<string, unknown>).workbookId = "foreign-book";
  const before = structuredClone(input);

  const frozen = await freezeNovemberImportSnapshot(input);
  assert.equal(frozen.ok, false);
  if (!frozen.ok) assert.equal(frozen.code, "validation");

  const preview = await previewNovemberImport(IMPORT_ACTOR, harness.deps, {
    ...previewRequest(),
    snapshot: input as unknown as MoneyImportSourceSnapshot,
  });
  assert.equal(preview.ok, false);
  if (!preview.ok) assert.equal(preview.code, "validation");
  assert.deepEqual(input, before);
  assert.deepEqual(writeCounts(harness), {
    adoption: 0,
    movement: 0,
    period: 0,
    visit: 0,
  });
});

test("an acknowledged reported-balance difference is disclosed, not posted as cash", async () => {
  const harness = createImportHarness();
  const input = novemberWorkbookInput();
  const rows = input.rows as Array<Record<string, unknown>>;
  const dashboard = rows.find((row) => row.sourceRowId === "D1");
  assert.ok(dashboard);
  (dashboard.raw as Record<string, unknown>).reportedClosing = 59.0;
  const source = createMoneyImportSnapshot(input);
  const preview = await previewNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    previewRequest(source),
  );
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  const acknowledged = preview.data.manifest.discrepancies.find(
    (entry) => entry.code === "reported_balance_difference",
  );
  assert.ok(acknowledged);

  const missing = await applyNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    applyRequest(source, approvalFrom(preview.data, { acknowledgedDiscrepancyIds: [] })),
  );
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "validation");

  const applied = await applyNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    applyRequest(source, approvalFrom(preview.data)),
  );
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.data.status, "adopted");
  assert.equal(applied.data.postReconciliation?.recordedClosingMinor, 5_875);
  assert.ok(
    applied.data.receipt.manifest.discrepancies.some(
      (entry) =>
        entry.code === "reported_balance_difference" &&
        entry.severity === "acknowledged",
    ),
  );
  assert.equal(harness.state.movements.filter((row) => row.kind !== "opening").length, 6);
});

test("a paid bill without a link matches one paid target obligation as evidence only", async () => {
  const harness = createImportHarness();
  const obligation = harness.seedObligation({
    description: "Internet",
    amountMinor: 700,
    dueDate: "2026-11-09",
    state: "paid",
    paymentExpenseId: null,
  });
  const input = novemberWorkbookInput();
  const rows = input.rows as Array<Record<string, unknown>>;
  const bill = rows.find((row) => row.sourceRowId === "B2");
  assert.ok(bill);
  delete (bill.raw as Record<string, unknown>).linkTo;
  const source = createMoneyImportSnapshot(input);
  const preview = await previewNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    previewRequest(source),
  );
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  const b2 = preview.data.manifest.candidates.find((entry) => entry.sourceRowId === "B2");
  assert.equal(b2?.action, "link");
  assert.equal(b2?.targetObligationId, obligation.id);

  const applied = await applyNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    applyRequest(source, approvalFrom(preview.data)),
  );
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.data.status, "adopted");
  assert.equal(harness.state.movements.filter((row) => row.kind !== "opening").length, 6);
  assert.equal(applied.data.postReconciliation?.recordedClosingMinor, 5_875);
});

test("B1 target movement added after preview invalidates the old approval with zero writes", async () => {
  const harness = createImportHarness();
  const source = snapshot();
  const preview = await previewNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    previewRequest(source),
  );
  assert.equal(preview.ok, true);
  if (!preview.ok) return;

  harness.seedMovement({
    idempotencyKey: "external-after-preview",
    kind: "expense",
    direction: "out",
    amountMinor: 100,
    category: "other",
    note: "Added after preview",
    merchant: "Misc",
    needVsWant: "need",
    purpose: "flexible",
    countsInDaily: false,
    bookingDate: "2026-11-20",
  });

  const writesBefore = writeCounts(harness);
  const applied = await applyNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    applyRequest(source, approvalFrom(preview.data)),
  );
  assert.equal(applied.ok, false);
  if (!applied.ok) assert.equal(applied.code, "conflict");
  assert.deepEqual(writeCounts(harness), writesBefore);
  assert.equal(harness.state.adoptions.size, 0);
});

test("B2 duplicate target claims block all writes", async () => {
  const harness = createImportHarness();
  harness.seedMovement({
    idempotencyKey: "target-existing-l7",
    kind: "expense",
    direction: "out",
    amountMinor: 500,
    category: "groceries",
    note: "Groceries",
    merchant: "Marjane",
    needVsWant: "need",
    purpose: "flexible",
    countsInDaily: true,
    bookingDate: "2026-11-06",
  });
  const input = novemberWorkbookInput();
  const rows = input.rows as Array<Record<string, unknown>>;
  const l7 = rows.find((row) => row.sourceRowId === "L7");
  assert.ok(l7);
  rows.push({ ...l7, sourceRowId: "L7B", rowIndex: 20 });
  const source = createMoneyImportSnapshot(input);
  const preview = await previewNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    previewRequest(source),
  );
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.ok(preview.data.manifest.blockers.includes("duplicate_target_claim"));
  const applied = await applyNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    applyRequest(source, approvalFrom(preview.data)),
  );
  assert.equal(applied.ok, false);
  if (!applied.ok) assert.equal(applied.code, "conflict");
  assert.deepEqual(writeCounts(harness), {
    adoption: 0,
    movement: 0,
    period: 0,
    visit: 0,
  });
});

test("N2 skip and link claims on one target movement are both blocked", async () => {
  const harness = createImportHarness();
  const existing = harness.seedMovement({
    idempotencyKey: `mi-mv:${NOVEMBER_SNAPSHOT_ID}:L7`,
    kind: "expense",
    direction: "out",
    amountMinor: 500,
    category: "groceries",
    note: "Groceries",
    merchant: "Marjane",
    needVsWant: "need",
    purpose: "flexible",
    countsInDaily: true,
    bookingDate: "2026-11-06",
  });
  const input = novemberWorkbookInput();
  const rows = input.rows as Array<Record<string, unknown>>;
  const l7 = rows.find((row) => row.sourceRowId === "L7");
  assert.ok(l7);
  rows.push({ ...l7, sourceRowId: "L7B", rowIndex: 20 });
  const source = createMoneyImportSnapshot(input);
  const preview = await previewNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    previewRequest(source),
  );
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.ok(preview.data.manifest.blockers.includes("duplicate_target_claim"));
  const l7Candidate = preview.data.manifest.candidates.find(
    (entry) => entry.sourceRowId === "L7",
  );
  const l7bCandidate = preview.data.manifest.candidates.find(
    (entry) => entry.sourceRowId === "L7B",
  );
  assert.equal(l7Candidate?.action, "conflict");
  assert.equal(l7bCandidate?.action, "conflict");

  const applied = await applyNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    applyRequest(source, approvalFrom(preview.data)),
  );
  assert.equal(applied.ok, false);
  if (!applied.ok) assert.equal(applied.code, "conflict");
  assert.equal(harness.state.adoptions.size, 0);
  assert.equal(harness.state.periods.length, 0);
  assert.equal(harness.state.visits.length, 0);
  assert.deepEqual(
    harness.state.movements.map((row) => row.id),
    [existing.id],
  );
  assert.deepEqual(writeCounts(harness), {
    adoption: 0,
    movement: 0,
    period: 0,
    visit: 0,
  });
});

test("N1 changed baseline classification refuses resume with zero writes", async () => {
  const harness = createImportHarness();
  const targetL7 = harness.seedMovement({
    idempotencyKey: "target-existing-l7",
    kind: "expense",
    direction: "out",
    amountMinor: 500,
    category: "groceries",
    note: "Groceries",
    merchant: "Marjane",
    needVsWant: "need",
    purpose: "flexible",
    countsInDaily: true,
    bookingDate: "2026-11-06",
  });
  const source = snapshot();
  const preview = await previewNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    previewRequest(source),
  );
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  const request = applyRequest(source, approvalFrom(preview.data));

  harness.state.failMovementCreateAfter = 3;
  const interrupted = await applyNovemberImport(IMPORT_ACTOR, harness.deps, request);
  assert.equal(interrupted.ok, false);
  if (!interrupted.ok) assert.equal(interrupted.reason, "apply_incomplete");

  const index = harness.state.movements.findIndex(
    (row) => row.id === targetL7.id,
  );
  assert.notEqual(index, -1);
  const original = { ...harness.state.movements[index]! };
  harness.state.movements[index] = {
    ...original,
    category: "other",
    note: "Changed note",
    merchant: "Other merchant",
  };

  harness.state.failMovementCreateAfter = null;
  const writesBeforeDrift = writeCounts(harness);
  const drifted = await applyNovemberImport(IMPORT_ACTOR, harness.deps, request);
  assert.equal(drifted.ok, false);
  if (!drifted.ok) {
    assert.equal(drifted.code, "conflict");
    assert.equal(drifted.reason, "target_drift");
  }
  assert.deepEqual(writeCounts(harness), writesBeforeDrift);
  assert.equal(
    harness.state.movements.filter((row) => row.idempotencyKey.startsWith("mi-mv:")).length,
    3,
  );

  harness.state.movements[index] = original;
  const resumed = await applyNovemberImport(IMPORT_ACTOR, harness.deps, request);
  assert.equal(resumed.ok, true);
  if (!resumed.ok) return;
  assert.equal(resumed.data.status, "adopted");
  assert.equal(resumed.data.postReconciliation?.recordedClosingMinor, 5_875);
});

test("N1 post-apply linked classification mismatch forces review_needed", async () => {
  const harness = createImportHarness();
  const targetL7 = harness.seedMovement({
    idempotencyKey: "target-existing-l7",
    kind: "expense",
    direction: "out",
    amountMinor: 500,
    category: "groceries",
    note: "Groceries",
    merchant: "Marjane",
    needVsWant: "need",
    purpose: "flexible",
    countsInDaily: true,
    bookingDate: "2026-11-06",
  });
  const source = snapshot();
  const preview = await previewNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    previewRequest(source),
  );
  assert.equal(preview.ok, true);
  if (!preview.ok) return;

  harness.state.afterMovementCreate = (count) => {
    if (count !== 1) return;
    const index = harness.state.movements.findIndex(
      (row) => row.id === targetL7.id,
    );
    if (index < 0) return;
    harness.state.movements[index] = {
      ...harness.state.movements[index]!,
      category: "other",
      note: "Changed after approval",
      merchant: "Other merchant",
    };
  };

  const applied = await applyNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    applyRequest(source, approvalFrom(preview.data)),
  );
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.data.status, "review_needed");
  assert.ok(
    applied.data.postReconciliation?.discrepancies.some(
      (entry) => entry.code === "linked_movement_mismatch",
    ),
  );
  assert.equal(applied.data.receipt.status, "review_needed");
});

test("N1 post-apply coffee visit date/line mismatch forces review_needed", async () => {
  const harness = createImportHarness();
  const source = snapshot();
  const preview = await previewNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    previewRequest(source),
  );
  assert.equal(preview.ok, true);
  if (!preview.ok) return;

  harness.state.afterCoffeeVisitCreate = (visitId) => {
    const index = harness.state.visits.findIndex(
      (visit) => visit.id === visitId,
    );
    if (index < 0) return;
    const original = harness.state.visits[index]!;
    harness.state.visits[index] = {
      ...original,
      localDate: "2026-11-04",
      lines: original.lines.map((line) => ({
        ...line,
        expenseId: "00000000-0000-4000-8000-999999999999",
      })),
    };
  };

  const applied = await applyNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    applyRequest(source, approvalFrom(preview.data)),
  );
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.data.status, "review_needed");
  assert.ok(
    applied.data.postReconciliation?.discrepancies.some(
      (entry) => entry.code === "coffee_visit_mismatch",
    ),
  );
  assert.equal(applied.data.receipt.status, "review_needed");
});

test("B3 cutover balance sets the period opening and expected closing", async () => {
  const harness = createImportHarness();
  const source = snapshot();
  const cutover: MoneyImportCutover = {
    ...CUTOVER,
    reportedBalanceMinor: 9_900,
  };
  const preview = await previewNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    previewRequest(source, cutover),
  );
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.equal(preview.data.manifest.period.opening.amountMinor, 9_900);
  assert.equal(preview.data.manifest.summary.cashEquation.expectedClosingMinor, 5_775);

  const applied = await applyNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    applyRequest(source, approvalFrom(preview.data), cutover),
  );
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.data.status, "adopted");
  assert.equal(harness.state.openings.get(
    harness.state.periods[0]!.openingMovementId!,
  )?.amountMinor, 9_900);
  assert.equal(applied.data.postReconciliation?.expectedClosingMinor, 5_775);
  assert.equal(applied.data.postReconciliation?.recordedClosingMinor, 5_775);
});

test("B4 older pre-cutover target movements block preview and apply", async () => {
  const harness = createImportHarness();
  const oldRow = harness.seedMovement({
    idempotencyKey: "old-pre-cutover",
    kind: "income",
    direction: "in",
    amountMinor: 1,
    bookingDate: "2026-09-15",
    note: "Older history",
  });
  const source = snapshot();
  const preview = await previewNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    previewRequest(source),
  );
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.ok(preview.data.manifest.blockers.includes("existing_pre_cutover_movement"));
  assert.ok(
    preview.data.manifest.targetBaseline.movements.some(
      (movement) => movement.id === oldRow.id,
    ),
  );
  const applied = await applyNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    applyRequest(source, approvalFrom(preview.data)),
  );
  assert.equal(applied.ok, false);
  if (!applied.ok) assert.equal(applied.code, "conflict");
  assert.deepEqual(writeCounts(harness), {
    adoption: 0,
    movement: 0,
    period: 0,
    visit: 0,
  });
});

test("B5 unsupported sheets and out-of-month cash fail preview with zero writes", async () => {
  const cases: Array<{
    code: string;
    mutate: (input: Record<string, unknown>) => void;
  }> = [
    {
      code: "unsupported_sheet",
      mutate: (input) => {
        (input.tabs as string[]).push("Routine");
        (input.rows as Array<Record<string, unknown>>).push({
          sourceRowId: "R1",
          sheet: "Routine",
          rowIndex: 2,
          raw: {
            type: "expense",
            date: "2026-11-10",
            amount: -1,
            category: "other",
            needVsWant: "need",
          },
        });
      },
    },
    {
      code: "outside_snapshot_month",
      mutate: (input) => {
        (input.rows as Array<Record<string, unknown>>).push({
          sourceRowId: "L12",
          sheet: "Ledger",
          rowIndex: 12,
          raw: {
            type: "expense",
            date: "2026-12-10",
            amount: -1,
            category: "other",
            needVsWant: "need",
          },
        });
      },
    },
  ];

  for (const testCase of cases) {
    const harness = createImportHarness();
    const input = novemberWorkbookInput();
    testCase.mutate(input);
    const before = structuredClone(input);
    const source = createMoneyImportSnapshot(input);
    const preview = await previewNovemberImport(
      IMPORT_ACTOR,
      harness.deps,
      previewRequest(source),
    );
    assert.equal(preview.ok, true);
    if (!preview.ok) continue;
    assert.ok(preview.data.manifest.blockers.includes(testCase.code));
    const applied = await applyNovemberImport(
      IMPORT_ACTOR,
      harness.deps,
      applyRequest(source, approvalFrom(preview.data)),
    );
    assert.equal(applied.ok, false);
    assert.deepEqual(input, before);
    assert.deepEqual(writeCounts(harness), {
      adoption: 0,
      movement: 0,
      period: 0,
      visit: 0,
    });
  }
});

test("Daily Tracker cash is blocked while derived tracker rows stay non-cash", async () => {
  const harness = createImportHarness();
  const input = novemberWorkbookInput();
  (input.tabs as string[]).push("Daily Tracker");
  const rows = input.rows as Array<Record<string, unknown>>;
  rows.push({
    sourceRowId: "DT1",
    sheet: "Daily Tracker",
    rowIndex: 2,
    raw: {
      type: "expense",
      date: "2026-11-10",
      amount: -1,
      category: "other",
      needVsWant: "need",
    },
  });
  rows.push({
    sourceRowId: "DT2",
    sheet: "Daily Tracker",
    rowIndex: 3,
    raw: {
      type: "running_balance",
      date: "2026-11-30",
      amount: 1,
    },
  });
  const source = createMoneyImportSnapshot(input);
  const preview = await previewNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    previewRequest(source),
  );
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.ok(
    preview.data.manifest.blockers.includes("sheet_classification_mismatch"),
  );
  const expense = preview.data.manifest.candidates.find(
    (entry) => entry.sourceRowId === "DT1",
  );
  assert.equal(expense?.classification, "unresolved");
  assert.equal(expense?.action, "conflict");
  assert.equal(expense?.kind, null);
  const derived = preview.data.manifest.candidates.find(
    (entry) => entry.sourceRowId === "DT2",
  );
  assert.equal(derived?.classification, "derived");
  assert.equal(derived?.action, "skip");
  assert.equal(derived?.signedEffectMinor, 0);

  const applied = await applyNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    applyRequest(source, approvalFrom(preview.data)),
  );
  assert.equal(applied.ok, false);
  if (!applied.ok) assert.equal(applied.code, "conflict");
  assert.deepEqual(writeCounts(harness), {
    adoption: 0,
    movement: 0,
    period: 0,
    visit: 0,
  });
  assert.equal(harness.state.adoptions.size, 0);
  assert.equal(harness.state.periods.length, 0);
  assert.equal(harness.state.movements.length, 0);
  assert.equal(harness.state.visits.length, 0);
});

test("B6 a coffee link to a groceries expense is a blocking preview and never starts adoption", async () => {
  const harness = createImportHarness();
  const input = novemberWorkbookInput();
  (input.rows as Array<Record<string, unknown>>).push({
    sourceRowId: "C7",
    sheet: "Coffee",
    rowIndex: 7,
    raw: {
      type: "coffee",
      date: "2026-11-06",
      amount: 5,
      linkTo: "L7",
      merchant: "Marjane",
      note: "Wrong category",
    },
  });
  const source = createMoneyImportSnapshot(input);
  const preview = await previewNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    previewRequest(source),
  );
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.ok(preview.data.manifest.blockers.includes("coffee_link_invalid"));
  const applied = await applyNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    applyRequest(source, approvalFrom(preview.data)),
  );
  assert.equal(applied.ok, false);
  assert.equal(harness.state.adoptions.size, 0);
  assert.deepEqual(writeCounts(harness), {
    adoption: 0,
    movement: 0,
    period: 0,
    visit: 0,
  });
});

test("an extra target movement in the period forces review_needed, never adopted", async () => {
  const harness = createImportHarness();
  const extra = harness.seedMovement({
    idempotencyKey: "external-unrelated-in-period",
    kind: "expense",
    direction: "out",
    amountMinor: 111,
    category: "other",
    note: "Unrelated",
    merchant: "Misc",
    needVsWant: "need",
    purpose: "flexible",
    countsInDaily: false,
    bookingDate: "2026-11-20",
  });
  const source = snapshot();
  const preview = await previewNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    previewRequest(source),
  );
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  const applied = await applyNovemberImport(
    IMPORT_ACTOR,
    harness.deps,
    applyRequest(source, approvalFrom(preview.data)),
  );
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.data.status, "review_needed");
  assert.equal(applied.data.receipt.status, "review_needed");
  assert.equal(applied.data.postReconciliation?.movementCount, 7);
  assert.notEqual(applied.data.postReconciliation?.differenceMinor, 0);
  assert.ok(
    applied.data.postReconciliation?.discrepancies.some(
      (entry) => entry.code === "movement_count_mismatch",
    ),
  );
  assert.ok(
    harness.state.movements.some((row) => row.id === extra.id),
  );
});
