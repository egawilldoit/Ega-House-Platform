import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "../src/auth/actor";
import {
  getMoneyRolloverPreviewForPeriod,
  rolloverMoneyPeriod,
} from "../src/money/rollover";
import type {
  MoneyRolloverRecord,
  MoneyRolloverRepository,
  MoneyRolloverSourceContext,
  MoneyRolloverWriteInput,
} from "../src/money/rollover-ports";
import type { MoneyPeriod } from "@ega/domain/money";

const actor = createAuthenticatedActor("11111111-1111-4111-8111-111111111111");

function endedPeriod(overrides: Partial<MoneyPeriod> = {}): MoneyPeriod {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    startDate: "2026-11-12",
    endDate: "2026-11-30",
    currency: "MAD",
    timezone: "Africa/Casablanca",
    activeDate: "2026-11-30",
    lifecycle: "ended",
    initialization: "initialized",
    openingMovementId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    provenance: { opening: null, createdFrom: "web" },
    settings: { savingsTargetMinor: 12_000 },
    version: 4,
    createdAt: "2026-11-12T00:00:00.000Z",
    updatedAt: "2026-11-30T00:00:00.000Z",
    ...overrides,
  };
}

function recordFor(input: MoneyRolloverWriteInput): MoneyRolloverRecord {
  return {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    sourcePeriodId: input.values.sourcePeriodId,
    successorPeriodId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    successorPeriod: {
      ...endedPeriod(),
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      startDate: input.targets.startDate,
      endDate: input.targets.endDate,
      activeDate: input.targets.startDate,
      lifecycle: "tracking",
      version: 2,
    },
    operationId: input.operationId,
    requestFingerprint: input.requestFingerprint,
    openingMode: input.values.opening.mode,
    openingAmountMinor: input.opening.amountMinor,
    closingCashMinor: input.reconciliation.modeledClosingCashMinor,
    closingCutoffDate: input.reconciliation.cutoffDate,
    unpaidTreatment: input.values.unpaidItems?.treatment ?? null,
    reconciliationAcceptedNote: input.reconciliationAcceptedNote,
    generatedOccurrenceCount: input.obligations.length,
    carriedOccurrenceCount: input.carriedOccurrences.length,
    cancelledOccurrenceCount: 0,
    createdAt: input.createdAt,
  };
}

function fakeRepository(context: MoneyRolloverSourceContext) {
  const writes: MoneyRolloverWriteInput[] = [];
  const records: MoneyRolloverRecord[] = [];
  const repository: MoneyRolloverRepository = {
    async getSourceContext() {
      return { ok: true, value: context };
    },
    async findRolloverByOperation(_actor, operationId) {
      return {
        ok: true,
        value: records.find((entry) => entry.operationId === operationId) ?? null,
      };
    },
    async rollover(_actor, input) {
      writes.push(input);
      const record = recordFor(input);
      records.push(record);
      return { ok: true, value: { record, replayed: false } };
    },
  };
  return { repository, writes, records };
}

const noTemplates = {
  async listTemplates() {
    return { ok: true as const, value: [] };
  },
};

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    sourcePeriodId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    expectedVersion: 4,
    startDate: "2026-12-01",
    endDate: "2026-12-19",
    opening: { mode: "carry_forward" },
    unpaidItems: null,
    settingsOverrides: null,
    allowUncoveredDays: false,
    acceptClosingDifferenceNote: null,
    ...overrides,
  };
}

function context(overrides: Partial<MoneyRolloverSourceContext> = {}): MoneyRolloverSourceContext {
  return {
    period: endedPeriod(),
    modeledClosingCashMinor: 68_900,
    cashComplete: true,
    pendingOccurrences: [],
    closeSnapshots: {
      available: true,
      closeCount: 19,
      lastClosedDate: "2026-11-30",
      comparableToRestatedTotals: true,
      restatedDifferenceCount: 0,
      paidObligationCount: 0,
      paidObligationMismatchCount: 0,
      countedVisitCount: 0,
      countedVisitMismatchCount: 0,
      savingsTargetMinor: null,
      savingsTransferredMinor: 0,
      restatedDifferences: [],
    },
    existingSuccessorPeriodId: null,
    existingRollover: null,
    ...overrides,
  };
}

test("carry-forward creates one successor opening from modeled closing cash", async () => {
  const fake = fakeRepository(context());
  const result = await rolloverMoneyPeriod(
    actor,
    { repository: fake.repository, obligations: noTemplates },
    baseInput(),
    "750e8400-e29b-41d4-a716-446655440000",
    { now: new Date("2026-12-01T09:00:00.000Z"), surface: "mcp" },
  );
  assert.equal(result.ok, true);
  assert.equal(fake.writes.length, 1);
  const write = fake.writes[0];
  assert.equal(write.opening.amountMinor, 68_900);
  assert.equal(write.opening.source, "carry_forward");
  assert.equal(write.initialized, "initialized");
  assert.equal(write.provenance.createdFrom, "mcp");
  assert.equal(write.targets.startDate, "2026-12-01");
  assert.deepEqual(write.settings, { savingsTargetMinor: 12_000 });
});

test("an identical retry replays and never writes a second successor", async () => {
  const fake = fakeRepository(context());
  const input = baseInput();
  const first = await rolloverMoneyPeriod(
    actor,
    { repository: fake.repository, obligations: noTemplates },
    input,
    "750e8400-e29b-41d4-a716-446655440000",
  );
  const second = await rolloverMoneyPeriod(
    actor,
    { repository: fake.repository, obligations: noTemplates },
    input,
    "750e8400-e29b-41d4-a716-446655440000",
  );
  assert.equal(first.ok && first.data.replayed, false);
  assert.equal(second.ok && second.data.replayed, true);
  assert.equal(fake.writes.length, 1);
});

test("a reused operation id with a different payload conflicts", async () => {
  const fake = fakeRepository(context());
  await rolloverMoneyPeriod(
    actor,
    { repository: fake.repository, obligations: noTemplates },
    baseInput(),
    "750e8400-e29b-41d4-a716-446655440000",
  );
  const changed = await rolloverMoneyPeriod(
    actor,
    { repository: fake.repository, obligations: noTemplates },
    baseInput({ endDate: "2026-12-20" }),
    "750e8400-e29b-41d4-a716-446655440000",
  );
  assert.equal(changed.ok, false);
  assert.equal(!changed.ok && changed.code, "conflict");
  assert.equal(fake.writes.length, 1);
});

test("a stale source version is a conflict, not a silent overwrite", async () => {
  const fake = fakeRepository(context());
  const result = await rolloverMoneyPeriod(
    actor,
    { repository: fake.repository, obligations: noTemplates },
    baseInput({ expectedVersion: 3 }),
    "750e8400-e29b-41d4-a716-446655440001",
  );
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.code, "conflict");
});

test("a tracking period cannot be rolled over before the final close", async () => {
  const fake = fakeRepository(context({ period: endedPeriod({ lifecycle: "tracking" }) }));
  const result = await rolloverMoneyPeriod(
    actor,
    { repository: fake.repository, obligations: noTemplates },
    baseInput(),
    "750e8400-e29b-41d4-a716-446655440002",
  );
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.errorMessage : "", /Close the final day/);
});

test("unknown closing cash is never carried forward as zero", async () => {
  const fake = fakeRepository(context({ modeledClosingCashMinor: null }));
  const result = await rolloverMoneyPeriod(
    actor,
    { repository: fake.repository, obligations: noTemplates },
    baseInput(),
    "750e8400-e29b-41d4-a716-446655440003",
  );
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.errorMessage : "", /unknown/i);
});

test("unpaid occurrences require an explicit treatment", async () => {
  const fake = fakeRepository(
    context({
      pendingOccurrences: [
        {
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          kind: "bill",
          description: "Internet",
          amountMinor: 20_000,
          dueDate: "2026-11-25",
          templateId: null,
          needVsWant: "need",
          purpose: "fixed",
          countsInDaily: false,
          category: "bills",
        },
      ],
    }),
  );
  const blocked = await rolloverMoneyPeriod(
    actor,
    { repository: fake.repository, obligations: noTemplates },
    baseInput(),
    "750e8400-e29b-41d4-a716-446655440004",
  );
  assert.equal(blocked.ok, false);
  assert.match(!blocked.ok ? blocked.errorMessage : "", /keep_pending/);

  const allowed = await rolloverMoneyPeriod(
    actor,
    { repository: fake.repository, obligations: noTemplates },
    baseInput({
      unpaidItems: { treatment: "carry_forward", reason: "still owed" },
    }),
    "750e8400-e29b-41d4-a716-446655440005",
  );
  assert.equal(allowed.ok, true);
  assert.equal(fake.writes.length, 1);
  assert.equal(fake.writes[0].carriedOccurrences.length, 1);
  assert.equal(fake.writes[0].carriedOccurrences[0].dueDate, "2026-12-14");
});

test("a verified opening difference needs an explicit acceptance note", async () => {
  const fake = fakeRepository(context());
  const verified = {
    mode: "verified_source" as const,
    amountMinor: 68_000,
    cutoffDate: "2026-11-30",
    evidence: "bank statement",
    note: null,
  };
  const blocked = await rolloverMoneyPeriod(
    actor,
    { repository: fake.repository, obligations: noTemplates },
    baseInput({ opening: verified }),
    "750e8400-e29b-41d4-a716-446655440006",
  );
  assert.equal(blocked.ok, false);
  assert.match(!blocked.ok ? blocked.errorMessage : "", /difference/i);

  const accepted = await rolloverMoneyPeriod(
    actor,
    { repository: fake.repository, obligations: noTemplates },
    baseInput({
      opening: verified,
      acceptClosingDifferenceNote: "counted cash difference accepted",
    }),
    "750e8400-e29b-41d4-a716-446655440007",
  );
  assert.equal(accepted.ok, true);
  assert.equal(fake.writes[0].initialized, "reconciled");
  assert.equal(fake.writes[0].opening.source, "verified_source");
});

test("restated close snapshots need an acceptance note before the write", async () => {
  const restated = {
    available: true as const,
    closeCount: 19,
    lastClosedDate: "2026-11-30",
    comparableToRestatedTotals: true as const,
    restatedDifferenceCount: 1,
    paidObligationCount: 0,
    paidObligationMismatchCount: 0,
    countedVisitCount: 0,
    countedVisitMismatchCount: 0,
    savingsTargetMinor: null,
    savingsTransferredMinor: 0,
    restatedDifferences: [
      {
        closeId: "close-1",
        closeDate: "2026-11-20",
        changedFields: ["expenseTotal", "recordedCash"],
      },
    ],
  };
  const blocked = await rolloverMoneyPeriod(
    actor,
    { repository: fakeRepository(context({ closeSnapshots: restated })).repository, obligations: noTemplates },
    baseInput(),
    "750e8400-e29b-41d4-a716-446655440009",
  );
  assert.equal(blocked.ok, false);
  assert.match(!blocked.ok ? blocked.errorMessage : "", /restated|acceptance/i);

  const fake = fakeRepository(context({ closeSnapshots: restated }));
  const accepted = await rolloverMoneyPeriod(
    actor,
    { repository: fake.repository, obligations: noTemplates },
    baseInput({ acceptClosingDifferenceNote: "reviewed restated close" }),
    "750e8400-e29b-41d4-a716-44665544000a",
  );
  assert.equal(accepted.ok, true);
  assert.equal(fake.writes.length, 1);
});

test("a verified opening cutoff after the successor start is rejected", async () => {
  const fake = fakeRepository(context());
  const result = await rolloverMoneyPeriod(
    actor,
    { repository: fake.repository, obligations: noTemplates },
    baseInput({
      opening: {
        mode: "verified_source",
        amountMinor: 68_900,
        cutoffDate: "2026-12-05",
        evidence: "statement",
        note: null,
      },
    }),
    "750e8400-e29b-41d4-a716-446655440008",
  );
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.errorMessage : "", /cutoff/);
});

test("preview surfaces the choices without writing", async () => {
  const fake = fakeRepository(
    context({
      pendingOccurrences: [
        {
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          kind: "bill",
          description: "Internet",
          amountMinor: 20_000,
          dueDate: "2026-11-25",
          templateId: null,
          needVsWant: "need",
          purpose: "fixed",
          countsInDaily: false,
          category: "bills",
        },
      ],
    }),
  );
  const result = await getMoneyRolloverPreviewForPeriod(
    actor,
    { repository: fake.repository, obligations: noTemplates },
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.data.ready, false);
  assert.equal(result.ok && result.data.choices.length, 1);
  assert.equal(fake.writes.length, 0);
  assert.equal(result.ok && result.data.targets.startDate, "2026-12-01");
});
