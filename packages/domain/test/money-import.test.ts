import assert from "node:assert/strict";
import test from "node:test";

import {
  MONEY_IMPORT_VERSION,
  MoneyImportSourceError,
  buildMoneyImportManifest,
  canonicalMoneyImportManifestPayload,
  canonicalMoneyImportSnapshotPayload,
  createMoneyImportSnapshot,
  moneyImportCashEquation,
  moneyImportCoffeeVisitKey,
  moneyImportMovementKey,
  moneyImportSignedEffectMinor,
  moneyImportTargetDrift,
  parseMoneyImportAmountMinor,
  validateMoneyImportApproval,
  type MoneyImportApproval,
  type MoneyImportCutover,
  type MoneyImportSourceSnapshot,
  type MoneyImportTarget,
} from "../src/money-import";
import {
  NOVEMBER_CUTOVER,
  NOVEMBER_SNAPSHOT_ID,
  novemberWorkbookInput,
} from "./fixtures/money-001-november";

const EMPTY_TARGET: MoneyImportTarget = {
  ownerId: "owner-a",
  environment: "test",
  movements: [],
  obligations: [],
  coffeeVisits: [],
};

function snapshotFrom(input: Record<string, unknown> = novemberWorkbookInput()) {
  return createMoneyImportSnapshot(input);
}

function manifestFrom(
  snapshot: MoneyImportSourceSnapshot = snapshotFrom(),
  target: MoneyImportTarget = EMPTY_TARGET,
) {
  return buildMoneyImportManifest({
    snapshot,
    target,
    cutover: NOVEMBER_CUTOVER as MoneyImportCutover,
  });
}

function rowById(input: Record<string, unknown>, sourceRowId: string) {
  const rows = input.rows as Array<Record<string, unknown>>;
  const row = rows.find((entry) => entry.sourceRowId === sourceRowId);
  assert.ok(row, `missing fixture row ${sourceRowId}`);
  return row;
}

function rawOf(input: Record<string, unknown>, sourceRowId: string) {
  const row = rowById(input, sourceRowId);
  return row.raw as Record<string, unknown>;
}

test("T21 exact numeric parsing rejects display strings and overprecision", () => {
  const accepted: Array<[unknown, number]> = [
    [100, 10_000],
    [100.1, 10_010],
    [-0.25, -25],
    ["100.00", 10_000],
    ["-0.25", -25],
    ["0.07", 7],
  ];
  for (const [input, expected] of accepted) {
    const parsed = parseMoneyImportAmountMinor(input);
    assert.equal(parsed.ok, true, JSON.stringify(input));
    if (parsed.ok) assert.equal(parsed.valueMinor, expected);
  }

  const rejected: unknown[] = [
    "100.00 MAD",
    "1,00",
    "1e2",
    "100.001",
    0.001,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "21474836.48",
    ".5",
    "+1",
  ];
  for (const input of rejected) {
    const parsed = parseMoneyImportAmountMinor(input);
    assert.equal(parsed.ok, false, JSON.stringify(input));
  }
});

test("T21 snapshot identity is stable after row reordering and remains deeply frozen", () => {
  const input = novemberWorkbookInput();
  const snapshot = snapshotFrom(input);
  const reordered = structuredClone(input);
  const rows = reordered.rows as unknown[];
  reordered.rows = [...rows].reverse();
  const reorderedSnapshot = snapshotFrom(reordered);

  assert.equal(
    canonicalMoneyImportSnapshotPayload(snapshot),
    canonicalMoneyImportSnapshotPayload(reorderedSnapshot),
  );
  assert.equal(snapshot.version, MONEY_IMPORT_VERSION);
  assert.equal(snapshot.rows.length, 14);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.rows), true);
  assert.equal(Object.isFrozen(snapshot.rows[0]), true);
  assert.equal(Object.isFrozen(snapshot.rows[0]!.raw), true);
  assert.throws(() => {
    (snapshot.rows[0] as { sheet: string }).sheet = "Other";
  }, TypeError);
  // The caller's source object is evidence, not scratch space.
  assert.equal(rawOf(input, "L4").amount, -10);
  assert.equal(rawOf(input, "D1").reportedClosing, 58.75);

  const l4 = snapshot.rows.find((row) => row.sourceRowId === "L4");
  assert.equal(l4?.raw.amount, -10);
  assert.equal(l4?.raw.category, "coffee");
  assert.equal(moneyImportMovementKey(snapshot.snapshotId, "L4").length <= 128, true);
  assert.equal(moneyImportCoffeeVisitKey(snapshot.snapshotId, "C1").length <= 128, true);
});

test("T21 signed effect applies direction exactly once, including negative adjustments", () => {
  const income = moneyImportSignedEffectMinor({
    kind: "income",
    direction: "in",
    amountMinor: 100,
  });
  const adjustment = moneyImportSignedEffectMinor({
    kind: "reconciliation_adjustment",
    direction: "out",
    amountMinor: 25,
  });
  const reversal = moneyImportSignedEffectMinor({
    kind: "reconciliation_adjustment",
    direction: "in",
    amountMinor: 25,
  });
  assert.equal(10_000 + income + adjustment, 10_075);
  assert.equal(income, 100);
  assert.equal(adjustment, -25);
  assert.equal(reversal, 25);
});

test("T25/T22 synthetic manifest classifies every row and excludes pre-cutover cash", () => {
  const manifest = manifestFrom();
  assert.equal(manifest.period.startDate, "2026-11-01");
  assert.equal(manifest.period.endDate, "2026-11-30");
  assert.equal(manifest.period.opening.amountMinor, 10_000);
  assert.equal(manifest.summary.cashEquation.expectedClosingMinor, 5_875);
  assert.equal(manifest.summary.cashEquation.reportedClosingMinor, 5_875);
  assert.equal(manifest.summary.cashEquation.differenceMinor, 0);
  assert.equal(manifest.blockers.length, 0);
  assert.equal(manifest.candidates.length, 14);

  const byId = new Map(manifest.candidates.map((entry) => [entry.sourceRowId, entry]));
  assert.equal(byId.get("O1")?.classification, "opening");
  assert.equal(byId.get("O1")?.action, "skip");
  assert.equal(byId.get("L1")?.action, "skip");
  assert.equal(byId.get("L1")?.reason, "included_in_cutover_opening");
  assert.equal(byId.get("L2")?.action, "skip");
  assert.equal(byId.get("L2")?.reason, "included_in_cutover_opening");
  assert.equal(byId.get("L1")?.countsTowardCashEquation, false);
  assert.equal(byId.get("L2")?.countsTowardCashEquation, false);

  assert.equal(byId.get("L4")?.bookingDate, "2026-11-03");
  assert.equal(byId.get("L1")?.bookingDate, "2026-10-30");
  assert.equal(byId.get("L4")?.kind, "expense");
  assert.equal(byId.get("L4")?.direction, "out");
  assert.equal(byId.get("L4")?.amountMinor, 1_000);
  assert.equal(byId.get("L4")?.signedEffectMinor, -1_000);
  assert.equal(byId.get("L4")?.provenance.category, "source");
  assert.equal(byId.get("L4")?.provenance.needVsWant, "source");
  assert.equal(byId.get("L4")?.provenance.purpose, "source");
  assert.equal(byId.get("L4")?.provenance.countsInDaily, "source");
  assert.equal(byId.get("L4")?.countsInDaily, true);

  assert.equal(byId.get("L6")?.classification, "reconciliation_adjustment");
  assert.equal(byId.get("L6")?.signedEffectMinor, -25);
  assert.notEqual(byId.get("L6")?.classification, "expense");
  assert.notEqual(byId.get("L6")?.classification, "income");

  assert.equal(byId.get("C1")?.classification, "coffee_link");
  assert.equal(byId.get("C1")?.signedEffectMinor, 0);
  assert.equal(byId.get("C1")?.countsTowardCashEquation, false);
  assert.equal(byId.get("C1")?.coffeeVisit?.linkedSourceRowId, "L4");
  assert.equal(byId.get("B1")?.classification, "bill_link");
  assert.equal(byId.get("B1")?.action, "skip");
  assert.equal(byId.get("B1")?.signedEffectMinor, 0);
  assert.equal(byId.get("B2")?.action, "link");
  assert.equal(byId.get("B2")?.signedEffectMinor, 0);
  assert.equal(byId.get("D1")?.classification, "derived");
  assert.equal(byId.get("D1")?.action, "skip");
  assert.equal(byId.get("D1")?.countsTowardCashEquation, false);
  assert.equal(byId.get("S1")?.classification, "settings_metadata");
  assert.equal(byId.get("S1")?.action, "skip");

  for (const entry of manifest.candidates) {
    if (entry.classification !== "derived") {
      assert.notEqual(entry.classification, "unresolved", entry.sourceRowId);
    }
  }
  assert.equal(manifest.summary.linkCoverage.coffeeRows, 1);
  assert.equal(manifest.summary.linkCoverage.coffeeLinked, 1);
  assert.equal(manifest.summary.linkCoverage.paidBills, 1);
  assert.equal(manifest.summary.linkCoverage.unpaidBills, 1);
  assert.deepEqual(moneyImportCashEquation(manifest), manifest.summary.cashEquation);
});

test("T28 foreign workbook/month rows are rejected and source is untouched", () => {
  for (const [field, value] of [
    ["workbookId", "someone-elses-workbook"],
    ["month", "2026-10"],
  ] as const) {
    const input = novemberWorkbookInput();
    rawOf(input, "L3")[field] = value;
    const before = structuredClone(input);
    assert.throws(
      () => createMoneyImportSnapshot(input),
      (error: unknown) =>
        error instanceof MoneyImportSourceError &&
        (field === "workbookId" ? error.reason === "foreign_workbook" : error.reason === "foreign_month"),
    );
    assert.deepEqual(input, before);
  }
});

test("snapshot raw data rejects non-JSON class instances", () => {
  const input = novemberWorkbookInput();
  rawOf(input, "L3").amount = new Date("2026-11-02T00:00:00.000Z");
  assert.throws(
    () => createMoneyImportSnapshot(input),
    (error: unknown) =>
      error instanceof MoneyImportSourceError && error.reason === "invalid_value",
  );
});

test("T22 unknown date, amount and category block adoption", () => {
  const input = novemberWorkbookInput();
  delete rawOf(input, "L3").date;
  rawOf(input, "L4").amount = "bad";
  delete rawOf(input, "L7").category;
  const manifest = manifestFrom(snapshotFrom(input));
  assert.ok(manifest.blockers.includes("unknown_date"));
  assert.ok(manifest.blockers.includes("not_numeric"));
  assert.ok(manifest.blockers.includes("unknown_category"));
  assert.ok(manifest.summary.unknowns >= 3);
});

test("T26 approval requires exact digests, owner, environment, and acknowledgements", () => {
  const manifest = manifestFrom();
  const digest = "a".repeat(64);
  const snapshotDigest = "b".repeat(64);
  const approval: MoneyImportApproval = {
    status: "approved",
    manifestDigest: digest,
    snapshotDigest,
    ownerId: "owner-a",
    environment: "test",
    approvedAt: "2026-11-23T10:00:00.000Z",
    approvedBy: "owner-a",
    acknowledgedDiscrepancyIds: [],
  };
  const expected = { ownerId: "owner-a", environment: "test", snapshotDigest };

  assert.equal(validateMoneyImportApproval(manifest, digest, approval, expected).ok, true);

  const wrongDigest = validateMoneyImportApproval(
    manifest,
    digest,
    { ...approval, manifestDigest: "c".repeat(64) },
    expected,
  );
  assert.equal(wrongDigest.ok, false);
  if (!wrongDigest.ok) assert.equal(wrongDigest.reason, "manifest_digest_mismatch");

  const wrongSnapshot = validateMoneyImportApproval(
    manifest,
    digest,
    { ...approval, snapshotDigest: "d".repeat(64) },
    expected,
  );
  assert.equal(wrongSnapshot.ok, false);
  if (!wrongSnapshot.ok) assert.equal(wrongSnapshot.reason, "snapshot_digest_mismatch");

  const wrongOwner = validateMoneyImportApproval(
    manifest,
    digest,
    { ...approval, ownerId: "owner-b" },
    expected,
  );
  assert.equal(wrongOwner.ok, false);
  if (!wrongOwner.ok) assert.equal(wrongOwner.reason, "owner_mismatch");

  const wrongEnvironment = validateMoneyImportApproval(
    manifest,
    digest,
    { ...approval, environment: "production" },
    expected,
  );
  assert.equal(wrongEnvironment.ok, false);
  if (!wrongEnvironment.ok) assert.equal(wrongEnvironment.reason, "environment_mismatch");

  const unapproved = validateMoneyImportApproval(
    manifest,
    digest,
    { ...approval, status: "draft" as "approved" },
    expected,
  );
  assert.equal(unapproved.ok, false);
  if (!unapproved.ok) assert.equal(unapproved.reason, "not_approved");

  const missing = validateMoneyImportApproval(manifest, digest, null, expected);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.reason, "missing_approval");

  const blockingInput = novemberWorkbookInput();
  const rows = blockingInput.rows as Array<Record<string, unknown>>;
  rows.push({
    sourceRowId: "X1",
    sheet: "Ledger",
    rowIndex: 20,
    raw: { type: "mystery", date: "2026-11-10", amount: 1 },
  });
  const blockingManifest = manifestFrom(snapshotFrom(blockingInput));
  const blocking = validateMoneyImportApproval(
    blockingManifest,
    digest,
    approval,
    expected,
  );
  assert.equal(blocking.ok, false);
  if (!blocking.ok) assert.equal(blocking.reason, "blocking_discrepancies");

  const differenceInput = novemberWorkbookInput();
  rawOf(differenceInput, "D1").reportedClosing = 59.0;
  const differenceManifest = manifestFrom(snapshotFrom(differenceInput));
  const acknowledged = differenceManifest.discrepancies.find(
    (entry) => entry.code === "reported_balance_difference",
  );
  assert.ok(acknowledged);
  const missingAcknowledgement = validateMoneyImportApproval(
    differenceManifest,
    digest,
    approval,
    expected,
  );
  assert.equal(missingAcknowledgement.ok, false);
  if (!missingAcknowledgement.ok) {
    assert.equal(missingAcknowledgement.reason, "unacknowledged_discrepancies");
  }
  const withAcknowledgement = validateMoneyImportApproval(
    differenceManifest,
    digest,
    {
      ...approval,
      acknowledgedDiscrepancyIds: [acknowledged.id],
    },
    expected,
  );
  assert.equal(withAcknowledgement.ok, true);
});

test("manifest payload is deterministic across row reordering and target idempotency", () => {
  const input = novemberWorkbookInput();
  const reordered = structuredClone(input);
  reordered.rows = [...(reordered.rows as unknown[])].reverse();
  const first = manifestFrom(snapshotFrom(input));
  const second = manifestFrom(snapshotFrom(reordered));
  assert.equal(
    canonicalMoneyImportManifestPayload(first),
    canonicalMoneyImportManifestPayload(second),
  );
  assert.equal(
    canonicalMoneyImportManifestPayload({ ...first, snapshotDigest: "e".repeat(64) }).includes("generatedAt"),
    false,
  );
  assert.equal(NOVEMBER_SNAPSHOT_ID, first.snapshotId);
});

test("full history requires an opening and replays the earliest opening", () => {
  const noOpening = novemberWorkbookInput();
  noOpening.rows = (noOpening.rows as Array<Record<string, unknown>>).filter(
    (row) => row.sourceRowId !== "O1",
  );
  const missing = buildMoneyImportManifest({
    snapshot: snapshotFrom(noOpening),
    target: EMPTY_TARGET,
    cutover: NOVEMBER_CUTOVER as MoneyImportCutover,
    openingStrategy: "full_history",
  });
  assert.ok(missing.blockers.includes("missing_opening"));

  const full = buildMoneyImportManifest({
    snapshot: snapshotFrom(),
    target: EMPTY_TARGET,
    cutover: NOVEMBER_CUTOVER as MoneyImportCutover,
    openingStrategy: "full_history",
  });
  assert.equal(full.period.startDate, "2026-11-01");
  assert.equal(full.summary.cashEquation.expectedClosingMinor, 5_875);
  assert.equal(full.blockers.length, 0);
  assert.equal(
    full.candidates.find((entry) => entry.sourceRowId === "L1")?.reason,
    "before_opening_balance",
  );
});

test("B1 target baseline binds target state and drift rejects extra or changed rows", () => {
  const targetMovement = {
    id: "target-l7",
    idempotencyKey: "target-existing-l7",
    kind: "expense" as const,
    direction: "out" as const,
    amountMinor: 500,
    category: "groceries" as const,
    note: "Groceries",
    merchant: "Marjane",
    bookingDate: "2026-11-06",
    deletedAt: null,
  };
  const target: MoneyImportTarget = {
    ...EMPTY_TARGET,
    movements: [targetMovement],
  };
  const manifest = manifestFrom(snapshotFrom(), target);
  assert.equal(manifest.targetBaseline.movements.length, 1);
  assert.equal(manifest.targetBaseline.movements[0]?.id, "target-l7");
  assert.equal(moneyImportTargetDrift(manifest, target).ok, true);

  const extra = moneyImportTargetDrift(manifest, {
    ...target,
    movements: [
      ...target.movements,
      {
        ...targetMovement,
        id: "unexpected-movement",
        idempotencyKey: "unexpected-key",
        bookingDate: "2026-11-10",
      },
    ],
  });
  assert.equal(extra.ok, false);
  if (!extra.ok) {
    assert.ok(extra.reasons.some((reason) => reason.startsWith("unexpected_target_movement")));
  }

  const changed = moneyImportTargetDrift(manifest, {
    ...target,
    movements: [{ ...targetMovement, amountMinor: 501 }],
  });
  assert.equal(changed.ok, false);
  if (!changed.ok) {
    assert.ok(changed.reasons.some((reason) => reason.startsWith("baseline_movement_changed")));
  }

  for (const overrides of [
    { category: "other" as const },
    { note: "Changed note" },
    { merchant: "Other merchant" },
  ]) {
    const classificationDrift = moneyImportTargetDrift(manifest, {
      ...target,
      movements: [{ ...targetMovement, ...overrides }],
    });
    assert.equal(classificationDrift.ok, false);
    if (!classificationDrift.ok) {
      assert.ok(
        classificationDrift.reasons.some((reason) =>
          reason.startsWith("baseline_movement_changed"),
        ),
      );
    }
  }

  const duplicate = moneyImportTargetDrift(manifest, {
    ...target,
    movements: [targetMovement, { ...targetMovement, id: "target-l7-copy" }],
  });
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) {
    assert.ok(
      duplicate.reasons.some((reason) =>
        reason.startsWith("duplicate_target_idempotency_key"),
      ),
    );
  }

  const targetWithReferences: MoneyImportTarget = {
    ...EMPTY_TARGET,
    obligations: [
      {
        id: "obligation-1",
        description: "Internet",
        amountMinor: 700,
        dueDate: "2026-11-09",
        periodStart: "2026-11-01",
        periodEnd: "2026-11-30",
        state: "paid",
        paymentExpenseId: "expense-1",
      },
    ],
    coffeeVisits: [
      {
        id: "visit-1",
        visitKey: "existing-visit",
        localDate: "2026-11-03",
        expenseIds: ["expense-1"],
      },
    ],
  };
  const referenceManifest = manifestFrom(snapshotFrom(), targetWithReferences);
  assert.equal(
    moneyImportTargetDrift(referenceManifest, targetWithReferences).ok,
    true,
  );
  const changedObligation = moneyImportTargetDrift(referenceManifest, {
    ...targetWithReferences,
    obligations: [
      { ...targetWithReferences.obligations[0]!, state: "pending" },
    ],
  });
  assert.equal(changedObligation.ok, false);
  if (!changedObligation.ok) {
    assert.ok(
      changedObligation.reasons.some((reason) =>
        reason.startsWith("baseline_obligation_changed"),
      ),
    );
  }
  const extraCoffee = moneyImportTargetDrift(referenceManifest, {
    ...targetWithReferences,
    coffeeVisits: [
      ...targetWithReferences.coffeeVisits,
      {
        id: "visit-2",
        visitKey: "unexpected-visit",
        localDate: "2026-11-04",
        expenseIds: ["expense-2"],
      },
    ],
  });
  assert.equal(extraCoffee.ok, false);
  if (!extraCoffee.ok) {
    assert.ok(
      extraCoffee.reasons.some((reason) =>
        reason.startsWith("unexpected_target_coffee_visit"),
      ),
    );
  }

  const changedCoffeeDate = moneyImportTargetDrift(referenceManifest, {
    ...targetWithReferences,
    coffeeVisits: [
      { ...targetWithReferences.coffeeVisits[0]!, localDate: "2026-11-04" },
    ],
  });
  assert.equal(changedCoffeeDate.ok, false);
  if (!changedCoffeeDate.ok) {
    assert.ok(
      changedCoffeeDate.reasons.some((reason) =>
        reason.startsWith("baseline_coffee_visit_changed"),
      ),
    );
  }

  const changedCoffeeExpenses = moneyImportTargetDrift(referenceManifest, {
    ...targetWithReferences,
    coffeeVisits: [
      { ...targetWithReferences.coffeeVisits[0]!, expenseIds: ["expense-2"] },
    ],
  });
  assert.equal(changedCoffeeExpenses.ok, false);
  if (!changedCoffeeExpenses.ok) {
    assert.ok(
      changedCoffeeExpenses.reasons.some((reason) =>
        reason.startsWith("baseline_coffee_visit_changed"),
      ),
    );
  }
});

test("B2 two source rows cannot claim the same existing target movement", () => {
  const input = novemberWorkbookInput();
  const rows = input.rows as Array<Record<string, unknown>>;
  const l7 = rowById(input, "L7");
  rows.push({
    ...l7,
    sourceRowId: "L7B",
    rowIndex: 20,
  });
  const target: MoneyImportTarget = {
    ...EMPTY_TARGET,
    movements: [
      {
        id: "target-l7",
        idempotencyKey: "target-existing-l7",
        kind: "expense",
        direction: "out",
        amountMinor: 500,
        category: "groceries",
        note: "Groceries",
        merchant: "Marjane",
        bookingDate: "2026-11-06",
        deletedAt: null,
      },
    ],
  };
  const manifest = manifestFrom(snapshotFrom(input), target);
  assert.ok(manifest.blockers.includes("duplicate_target_claim"));
  const duplicateCandidates = manifest.candidates.filter(
    (entry) => entry.sourceRowId === "L7" || entry.sourceRowId === "L7B",
  );
  assert.equal(duplicateCandidates.length, 2);
  for (const entry of duplicateCandidates) {
    assert.equal(entry.action, "conflict");
    assert.equal(entry.targetMovementId, null);
  }
});

test("B3 verified cutover balance is the opening authority", () => {
  const cutover: MoneyImportCutover = {
    ...NOVEMBER_CUTOVER,
    reportedBalanceMinor: 9_900,
  };
  const manifest = buildMoneyImportManifest({
    snapshot: snapshotFrom(),
    target: EMPTY_TARGET,
    cutover,
    openingStrategy: "verified_cutover_opening",
  });
  assert.equal(manifest.period.opening.amountMinor, 9_900);
  assert.equal(manifest.summary.cashEquation.expectedClosingMinor, 5_775);
  assert.ok(
    manifest.discrepancies.some(
      (entry) =>
        entry.code === "cutover_opening_difference" &&
        entry.severity === "acknowledged",
    ),
  );
});

test("B5 sheet roles and snapshot-month containment block preview cash", () => {
  const routine = novemberWorkbookInput();
  (routine.tabs as string[]).push("Routine");
  (routine.rows as Array<Record<string, unknown>>).push({
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
  const routineManifest = manifestFrom(snapshotFrom(routine));
  assert.ok(routineManifest.blockers.includes("unsupported_sheet"));

  const mismatch = novemberWorkbookInput();
  (mismatch.rows as Array<Record<string, unknown>>).push({
    sourceRowId: "C9",
    sheet: "Coffee",
    rowIndex: 9,
    raw: {
      type: "expense",
      date: "2026-11-10",
      amount: -1,
      category: "coffee",
      needVsWant: "want",
    },
  });
  const mismatchManifest = manifestFrom(snapshotFrom(mismatch));
  assert.ok(mismatchManifest.blockers.includes("sheet_classification_mismatch"));

  const december = novemberWorkbookInput();
  (december.rows as Array<Record<string, unknown>>).push({
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
  const decemberManifest = manifestFrom(snapshotFrom(december));
  assert.ok(decemberManifest.blockers.includes("outside_snapshot_month"));
});

test("B6 coffee link must target a coffee-category expense", () => {
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
  const manifest = manifestFrom(snapshotFrom(input));
  assert.ok(manifest.blockers.includes("coffee_link_invalid"));
  assert.equal(
    manifest.candidates.find((entry) => entry.sourceRowId === "C7")?.action,
    "conflict",
  );
});

test("allowlist aliases accept Fixed Bills and derived ledger rows without cash", () => {
  const input = novemberWorkbookInput();
  (input.tabs as string[]).push("Fixed Bills");
  const rows = input.rows as Array<Record<string, unknown>>;
  rows.push({
    sourceRowId: "FB1",
    sheet: "Fixed Bills",
    rowIndex: 2,
    raw: {
      type: "bill",
      dueDate: "2026-11-09",
      amount: 7,
      paid: true,
      linkTo: "L9",
      description: "Internet",
    },
  });
  rows.push({
    sourceRowId: "LD1",
    sheet: "Ledger",
    rowIndex: 20,
    raw: {
      type: "running_balance",
      date: "2026-11-30",
      amount: 1,
    },
  });
  const manifest = manifestFrom(snapshotFrom(input));
  const fixedBill = manifest.candidates.find(
    (entry) => entry.sourceRowId === "FB1",
  );
  assert.equal(fixedBill?.classification, "bill_link");
  assert.equal(fixedBill?.action, "link");
  const derived = manifest.candidates.find(
    (entry) => entry.sourceRowId === "LD1",
  );
  assert.equal(derived?.classification, "derived");
  assert.equal(derived?.action, "skip");
  assert.equal(derived?.signedEffectMinor, 0);
  assert.equal(derived?.countsTowardCashEquation, false);
  assert.equal(
    manifest.blockers.includes("sheet_classification_mismatch"),
    false,
  );
});

test("Daily Tracker is a non-cash tracker sheet role", () => {
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
  const manifest = manifestFrom(snapshotFrom(input));
  const expense = manifest.candidates.find(
    (entry) => entry.sourceRowId === "DT1",
  );
  assert.equal(expense?.classification, "unresolved");
  assert.equal(expense?.action, "conflict");
  assert.equal(expense?.kind, null);
  assert.equal(expense?.amountMinor, null);
  assert.ok(manifest.blockers.includes("sheet_classification_mismatch"));
  const derived = manifest.candidates.find(
    (entry) => entry.sourceRowId === "DT2",
  );
  assert.equal(derived?.classification, "derived");
  assert.equal(derived?.action, "skip");
  assert.equal(derived?.signedEffectMinor, 0);
  assert.equal(derived?.countsTowardCashEquation, false);
});
