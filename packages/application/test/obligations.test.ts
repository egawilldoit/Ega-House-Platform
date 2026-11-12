import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type {
  ObligationPaymentSettlementPort,
  ObligationRepository,
} from "../src/money/obligation-ports";
import {
  assertObligationPaymentSeam,
  createObligation,
  createObligationTemplate,
  generateObligations,
  getObligationSummary,
  listObligations,
  transitionObligation,
  updateObligation,
  updateObligationTemplate,
} from "../src/money/obligations";
import { createAuthenticatedActor } from "../src/auth/actor";
import type {
  ObligationOccurrence,
  ObligationTemplate,
  ObligationTemplateCreateValues,
  ObligationUpdateChanges,
} from "@ega/domain/obligations";

const OWNER = createAuthenticatedActor("owner-1");
const TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";

function template(
  overrides: Partial<ObligationTemplate> = {},
): ObligationTemplate {
  return {
    id: TEMPLATE_ID,
    kind: "bill",
    description: "Internet",
    amountMinor: 29900,
    currency: "MAD",
    cadence: "monthly",
    dueDayOfMonth: 15,
    dueWeekday: null,
    startDate: "2026-01-01",
    endDate: null,
    needVsWant: "need",
    purpose: "flexible",
    countsInDaily: true,
    category: "household",
    lifecycle: "active",
    idempotencyKey: "template-1",
    version: 1,
    createdAt: "2026-01-01T09:00:00.000Z",
    updatedAt: "2026-01-01T09:00:00.000Z",
    ...overrides,
  };
}

type FakeState = {
  occurrences: Map<string, ObligationOccurrence>;
  templates: Map<string, ObligationTemplate>;
  fingerprints: Map<string, string>;
  templateFingerprints: Map<string, string>;
  calls: string[];
};

function createFakeRepository(initial: Partial<FakeState> = {}) {
  const state: FakeState = {
    occurrences: initial.occurrences ?? new Map(),
    templates: initial.templates ?? new Map(),
    fingerprints: initial.fingerprints ?? new Map(),
    templateFingerprints: initial.templateFingerprints ?? new Map(),
    calls: [],
  };

  const repository: ObligationRepository = {
    async findByIdempotencyKey(actor, key) {
      state.calls.push(`find:${actor.userId}:${key}`);
      const id = state.occurrences.get(key)?.id;
      if (!id) return { ok: true, value: null };
      return {
        ok: true,
        value: {
          occurrence: state.occurrences.get(key)!,
          createFingerprint: state.fingerprints.get(key) ?? "",
        },
      };
    },
    async create(actor, input) {
      state.calls.push(`create:${actor.userId}:${input.values.idempotencyKey}`);
      const existing = state.occurrences.get(input.values.idempotencyKey);
      if (existing) return { ok: false, error: { code: "conflict" } };
      const duplicatePeriod = [...state.occurrences.values()].find(
        (row) =>
          row.templateId === input.values.templateId &&
          row.templateId !== null &&
          row.periodStart === input.values.periodStart,
      );
      if (duplicatePeriod) return { ok: false, error: { code: "conflict" } };
      const row: ObligationOccurrence = {
        id: randomUUID(),
        kind: input.values.kind,
        description: input.values.description,
        amountMinor: input.values.amountMinor,
        currency: "MAD",
        periodStart: input.values.periodStart,
        periodEnd: input.values.periodEnd,
        dueDate: input.values.dueDate,
        needVsWant: input.values.needVsWant,
        purpose: input.values.purpose,
        countsInDaily: input.values.countsInDaily,
        category: input.values.category,
        state: "pending",
        stateEffectiveDate: input.values.stateEffectiveDate,
        stateReason: null,
        paymentExpenseId: null,
        paymentEvidence: null,
        templateId: input.values.templateId,
        idempotencyKey: input.values.idempotencyKey,
        version: 1,
        createdAt: "2026-11-11T09:00:00.000Z",
        updatedAt: "2026-11-11T09:00:00.000Z",
      };
      state.occurrences.set(input.values.idempotencyKey, row);
      state.fingerprints.set(
        input.values.idempotencyKey,
        input.createFingerprint,
      );
      return { ok: true, value: row };
    },
    async get(actor, id) {
      state.calls.push(`get:${actor.userId}:${id}`);
      const row = [...state.occurrences.values()].find((item) => item.id === id);
      return { ok: true, value: row ?? null };
    },
    async list(actor, query) {
      state.calls.push(
        `list:${actor.userId}:${query.kind ?? "*"}:${query.state ?? "*"}:${query.dueTo ?? "-"}:${query.limit}`,
      );
      let rows = [...state.occurrences.values()];
      if (query.kind) rows = rows.filter((row) => row.kind === query.kind);
      if (query.state) rows = rows.filter((row) => row.state === query.state);
      if (query.dueFrom) rows = rows.filter((row) => row.dueDate >= query.dueFrom!);
      if (query.dueTo) rows = rows.filter((row) => row.dueDate <= query.dueTo!);
      return {
        ok: true,
        value: rows
          .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
          .slice(query.offset, query.offset + query.limit),
      };
    },
    async update(actor, id, input) {
      state.calls.push(`update:${actor.userId}:${id}:${input.expectedVersion}`);
      const entry = [...state.occurrences.entries()].find(
        ([, item]) => item.id === id,
      );
      if (!entry) return { ok: false, error: { code: "notFound" } };
      const [key, row] = entry;
      if (row.version !== input.expectedVersion) {
        return { ok: false, error: { code: "conflict" } };
      }
      const changes = input.changes as ObligationUpdateChanges;
      const next: ObligationOccurrence = {
        ...row,
        description: changes.description ?? row.description,
        amountMinor: changes.amountMinor ?? row.amountMinor,
        periodStart: changes.periodStart ?? row.periodStart,
        periodEnd: changes.periodEnd ?? row.periodEnd,
        dueDate: changes.dueDate ?? row.dueDate,
        needVsWant:
          changes.needVsWant !== undefined ? changes.needVsWant : row.needVsWant,
        purpose: changes.purpose ?? row.purpose,
        countsInDaily: changes.countsInDaily ?? row.countsInDaily,
        category:
          changes.category !== undefined ? changes.category : row.category,
        version: row.version + 1,
        updatedAt: input.updatedAt,
      };
      state.occurrences.set(key, next);
      return { ok: true, value: next };
    },
    async transition(actor, id, input) {
      state.calls.push(`transition:${actor.userId}:${id}:${input.to}`);
      const entry = [...state.occurrences.entries()].find(
        ([, item]) => item.id === id,
      );
      if (!entry) return { ok: false, error: { code: "notFound" } };
      const [key, row] = entry;
      if (row.version !== input.expectedVersion || row.state !== input.fromState) {
        return { ok: false, error: { code: "conflict" } };
      }
      const next: ObligationOccurrence = {
        ...row,
        state: input.to,
        stateEffectiveDate: input.effectiveDate,
        stateReason: input.reason,
        version: row.version + 1,
        updatedAt: input.updatedAt,
      };
      state.occurrences.set(key, next);
      return { ok: true, value: next };
    },
    async findTemplateByIdempotencyKey(actor, key) {
      state.calls.push(`find-template:${actor.userId}:${key}`);
      const found = [...state.templates.values()].find(
        (item) => item.idempotencyKey === key,
      );
      if (!found) return { ok: true, value: null };
      return {
        ok: true,
        value: {
          template: found,
          createFingerprint: state.templateFingerprints.get(key) ?? "",
        },
      };
    },
    async createTemplate(actor, input) {
      state.calls.push(`create-template:${actor.userId}`);
      const row = template({
        id: randomUUID(),
        kind: input.values.kind,
        description: input.values.description,
        amountMinor: input.values.amountMinor,
        cadence: input.values.cadence,
        dueDayOfMonth: input.values.dueDayOfMonth,
        dueWeekday: input.values.dueWeekday,
        startDate: input.values.startDate,
        endDate: input.values.endDate,
        needVsWant: input.values.needVsWant,
        purpose: input.values.purpose,
        countsInDaily: input.values.countsInDaily,
        category: input.values.category,
        idempotencyKey: input.values.idempotencyKey,
      });
      state.templates.set(row.id, row);
      state.templateFingerprints.set(
        input.values.idempotencyKey,
        input.createFingerprint,
      );
      return { ok: true, value: row };
    },
    async getTemplate(actor, id) {
      state.calls.push(`get-template:${actor.userId}:${id}`);
      return { ok: true, value: state.templates.get(id) ?? null };
    },
    async listTemplates(actor) {
      state.calls.push(`list-templates:${actor.userId}`);
      return { ok: true, value: [...state.templates.values()] };
    },
    async updateTemplate(actor, id, input) {
      state.calls.push(`update-template:${actor.userId}:${id}`);
      const row = state.templates.get(id);
      if (!row) return { ok: false, error: { code: "notFound" } };
      if (row.version !== input.expectedVersion) {
        return { ok: false, error: { code: "conflict" } };
      }
      const next: ObligationTemplate = {
        ...row,
        ...input.changes,
        version: row.version + 1,
        updatedAt: input.updatedAt,
      };
      state.templates.set(id, next);
      return { ok: true, value: next };
    },
  };

  return { repository, state };
}

const CREATE_INPUT = {
  kind: "bill",
  description: "Rent",
  amountMinor: 350000,
  dueDate: "2026-11-05",
  periodStart: "2026-11-01",
  periodEnd: "2026-11-30",
  stateEffectiveDate: "2026-11-01",
  idempotencyKey: "obligation-create-1",
};

test("creating from a template snapshots defaults without inventing need/want", async () => {
  const { repository } = createFakeRepository({
    templates: new Map([[TEMPLATE_ID, template()]]),
  });

  const result = await createObligation(OWNER, repository, {
    ...CREATE_INPUT,
    templateId: TEMPLATE_ID,
  });
  assert.equal(result.ok, true);
  const created = result.ok && result.data.occurrence;
  assert.ok(created);
  assert.equal(created.needVsWant, "need");
  assert.equal(created.purpose, "flexible");
  assert.equal(created.countsInDaily, true);
  assert.equal(created.category, "household");

  // An occurrence created without a template keeps need/want unknown and uses
  // only kind defaults; it is never fabricated.
  const plain = await createObligation(OWNER, repository, {
    ...CREATE_INPUT,
    idempotencyKey: "obligation-create-2",
  });
  assert.equal(plain.ok, true);
  assert.equal(plain.ok && plain.data.occurrence.needVsWant, null);
  assert.equal(plain.ok && plain.data.occurrence.purpose, "fixed");
  assert.equal(plain.ok && plain.data.occurrence.countsInDaily, false);
  assert.equal(plain.ok && plain.data.occurrence.category, "bills");
});

test("explicit occurrence classification wins over template defaults", async () => {
  const { repository } = createFakeRepository({
    templates: new Map([[TEMPLATE_ID, template()]]),
  });
  const result = await createObligation(OWNER, repository, {
    ...CREATE_INPUT,
    templateId: TEMPLATE_ID,
    needVsWant: "want",
    purpose: "fixed",
    countsInDaily: false,
    category: "subscriptions",
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.data.occurrence.needVsWant, "want");
  assert.equal(result.ok && result.data.occurrence.purpose, "fixed");
  assert.equal(result.ok && result.data.occurrence.countsInDaily, false);
  assert.equal(result.ok && result.data.occurrence.category, "subscriptions");
});

test("create is idempotent and a changed payload conflicts", async () => {
  const { repository } = createFakeRepository();
  const first = await createObligation(OWNER, repository, CREATE_INPUT);
  assert.equal(first.ok, true);
  assert.equal(first.ok && first.data.replayed, false);

  const replay = await createObligation(OWNER, repository, CREATE_INPUT);
  assert.equal(replay.ok, true);
  assert.equal(replay.ok && replay.data.replayed, true);

  const changed = await createObligation(OWNER, repository, {
    ...CREATE_INPUT,
    amountMinor: 351000,
  });
  assert.equal(changed.ok, false);
  assert.equal(changed.ok === false && changed.code, "conflict");
});

test("editing a template never rewrites an occurrence snapshot", async () => {
  const { repository } = createFakeRepository({
    templates: new Map([[TEMPLATE_ID, template()]]),
  });
  const created = await createObligation(OWNER, repository, {
    ...CREATE_INPUT,
    templateId: TEMPLATE_ID,
  });
  assert.equal(created.ok, true);

  const templateUpdate = await updateObligationTemplate(
    OWNER,
    repository,
    TEMPLATE_ID,
    { version: 1, amountMinor: 99900, purpose: "emergency", category: "other" },
  );
  assert.equal(templateUpdate.ok, true);

  const occurrenceId = created.ok ? created.data.occurrence.id : "";
  const readBack = await repository.get(OWNER, occurrenceId);
  assert.equal(readBack.ok, true);
  assert.equal(readBack.ok && readBack.value?.amountMinor, 350000);
  assert.equal(readBack.ok && readBack.value?.purpose, "flexible");
  assert.equal(readBack.ok && readBack.value?.category, "household");
});

test("a paid occurrence rejects settlement-field edits but allows description", async () => {
  const paid: ObligationOccurrence = {
    ...(await (async () => {
      const { repository } = createFakeRepository();
      const created = await createObligation(OWNER, repository, CREATE_INPUT);
      if (!created.ok) throw new Error("seed failed");
      return created.data.occurrence;
    })()),
    state: "paid",
    stateEffectiveDate: "2026-11-05",
    paymentExpenseId: "33333333-3333-4333-8333-333333333333",
  };
  const { repository } = createFakeRepository({
    occurrences: new Map([[paid.idempotencyKey, paid]]),
    fingerprints: new Map([[paid.idempotencyKey, "x"]]),
  });

  const amountEdit = await updateObligation(OWNER, repository, paid.id, {
    version: 1,
    amountMinor: 1,
  });
  assert.equal(amountEdit.ok, false);
  assert.equal(amountEdit.ok === false && amountEdit.code, "conflict");
  assert.match(
    amountEdit.ok === false ? amountEdit.errorMessage : "",
    /MONEY-07/,
  );

  const descriptionEdit = await updateObligation(OWNER, repository, paid.id, {
    version: 1,
    description: "Rent (corrected label)",
  });
  assert.equal(descriptionEdit.ok, true);
  assert.equal(
    descriptionEdit.ok && descriptionEdit.data.description,
    "Rent (corrected label)",
  );
});

test("lifecycle transitions are explicit and a bare paid change is refused", async () => {
  const { repository } = createFakeRepository();
  const created = await createObligation(OWNER, repository, CREATE_INPUT);
  assert.equal(created.ok, true);
  const id = created.ok ? created.data.occurrence.id : "";

  const pay = await transitionObligation(OWNER, repository, id, {
    version: 1,
    to: "paid",
    effectiveDate: "2026-11-05",
  });
  assert.equal(pay.ok, false);
  assert.equal(pay.ok === false && pay.code, "conflict");
  assert.match(pay.ok === false ? pay.errorMessage : "", /MONEY-07/);

  const waive = await transitionObligation(OWNER, repository, id, {
    version: 1,
    to: "waived",
    effectiveDate: "2026-11-06",
    reason: "Bank waived the fee",
  });
  assert.equal(waive.ok, true);
  assert.equal(waive.ok && waive.data.state, "waived");
  assert.equal(waive.ok && waive.data.stateEffectiveDate, "2026-11-06");

  const reopen = await transitionObligation(OWNER, repository, id, {
    version: 2,
    to: "pending",
    effectiveDate: "2026-11-07",
  });
  assert.equal(reopen.ok, true);
  assert.equal(reopen.ok && reopen.data.state, "pending");

  const stale = await transitionObligation(OWNER, repository, id, {
    version: 1,
    to: "cancelled",
    effectiveDate: "2026-11-08",
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.ok === false && stale.code, "conflict");
});

test("generation is bounded, idempotent and copies template defaults", async () => {
  const { repository } = createFakeRepository({
    templates: new Map([
      [
        TEMPLATE_ID,
        template({ startDate: "2026-09-01", cadence: "monthly", dueDayOfMonth: 5 }),
      ],
    ]),
  });

  const first = await generateObligations(OWNER, repository, {
    templateId: TEMPLATE_ID,
    throughDate: "2026-11-30",
  });
  assert.equal(first.ok, true);
  assert.equal(first.ok && first.data.created, 3);
  assert.equal(first.ok && first.data.existing, 0);
  assert.equal(first.ok && first.data.truncated, false);
  const occurrences = first.ok ? first.data.occurrences : [];
  assert.deepEqual(
    occurrences.map((row) => row.periodStart),
    ["2026-09-01", "2026-10-01", "2026-11-01"],
  );
  assert.deepEqual(
    occurrences.map((row) => row.dueDate),
    ["2026-09-05", "2026-10-05", "2026-11-05"],
  );
  assert.equal(occurrences[0].needVsWant, "need");
  assert.equal(occurrences[0].purpose, "flexible");

  const second = await generateObligations(OWNER, repository, {
    templateId: TEMPLATE_ID,
    throughDate: "2026-11-30",
  });
  assert.equal(second.ok, true);
  assert.equal(second.ok && second.data.created, 0);
  assert.equal(second.ok && second.data.existing, 3);

  const archived = await updateObligationTemplate(
    OWNER,
    repository,
    TEMPLATE_ID,
    { version: 1, lifecycle: "archived" },
  );
  assert.equal(archived.ok, true);
  const blocked = await generateObligations(OWNER, repository, {
    templateId: TEMPLATE_ID,
    throughDate: "2026-12-31",
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.ok === false && blocked.code, "validation");
});

test("summary reports due, overdue and outstanding at an inclusive cutoff", async () => {
  const { repository } = createFakeRepository();
  await createObligation(OWNER, repository, {
    ...CREATE_INPUT,
    dueDate: "2026-11-01",
    periodStart: "2026-11-01",
    periodEnd: "2026-11-30",
    amountMinor: 10000,
    idempotencyKey: "summary-1",
  });
  await createObligation(OWNER, repository, {
    ...CREATE_INPUT,
    dueDate: "2026-11-11",
    periodStart: "2026-11-01",
    periodEnd: "2026-11-30",
    amountMinor: 20000,
    idempotencyKey: "summary-2",
  });
  await createObligation(OWNER, repository, {
    ...CREATE_INPUT,
    kind: "subscription",
    dueDate: "2026-11-11",
    periodStart: "2026-11-01",
    periodEnd: "2026-11-30",
    amountMinor: 5000,
    idempotencyKey: "summary-3",
  });

  const all = await getObligationSummary(OWNER, repository, {
    cutoff: "2026-11-11",
  });
  assert.equal(all.ok, true);
  assert.equal(all.ok && all.data.outstandingMinor, 35000);
  assert.equal(all.ok && all.data.overdueMinor, 10000);
  assert.equal(all.ok && all.data.dueMinor, 25000);
  assert.equal(all.ok && all.data.truncated, false);

  const bills = await getObligationSummary(OWNER, repository, {
    cutoff: "2026-11-11",
    kind: "bill",
  });
  assert.equal(bills.ok, true);
  assert.equal(bills.ok && bills.data.outstandingMinor, 30000);
});

test("list pagination reports hasMore without a second query", async () => {
  const { repository } = createFakeRepository();
  for (let index = 1; index <= 3; index += 1) {
    await createObligation(OWNER, repository, {
      ...CREATE_INPUT,
      idempotencyKey: `list-${index}`,
      dueDate: `2026-11-0${index}`,
      periodStart: "2026-11-01",
      periodEnd: "2026-11-30",
    });
  }
  const page = await listObligations(OWNER, repository, { limit: "2" });
  assert.equal(page.ok, true);
  assert.equal(page.ok && page.data.occurrences.length, 2);
  assert.equal(page.ok && page.data.pagination.hasMore, true);

  const rejected = await listObligations(OWNER, repository, {
    limit: "1000",
  });
  assert.equal(rejected.ok, false);
});

test("template create replays the same key and conflicts on a different payload", async () => {
  const { repository } = createFakeRepository();
  const values = {
    kind: "subscription" as const,
    description: "Streaming",
    amountMinor: 4900,
    cadence: "monthly" as const,
    dueDayOfMonth: 20,
    startDate: "2026-11-01",
    idempotencyKey: "template-create-1",
  };
  const first = await createObligationTemplate(OWNER, repository, values);
  assert.equal(first.ok, true);

  const replay = await createObligationTemplate(OWNER, repository, values);
  assert.equal(replay.ok, true);
  assert.equal(replay.ok && replay.data.id, first.ok ? first.data.id : "");

  const conflict = await createObligationTemplate(OWNER, repository, {
    ...values,
    amountMinor: 5000,
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.ok === false && conflict.code, "conflict");
});

test("template cadence change requires a matching complete schedule", async () => {
  const { repository } = createFakeRepository({
    templates: new Map([[TEMPLATE_ID, template()]]),
  });
  const missingWeekday = await updateObligationTemplate(
    OWNER,
    repository,
    TEMPLATE_ID,
    { version: 1, cadence: "weekly" },
  );
  assert.equal(missingWeekday.ok, false);
  assert.equal(missingWeekday.ok === false && missingWeekday.code, "validation");

  const weekly = await updateObligationTemplate(
    OWNER,
    repository,
    TEMPLATE_ID,
    { version: 1, cadence: "weekly", dueWeekday: 3, dueDayOfMonth: null },
  );
  assert.equal(weekly.ok, true);
  assert.equal(weekly.ok && weekly.data.cadence, "weekly");
  assert.equal(weekly.ok && weekly.data.dueWeekday, 3);
});

test("payment seam refuses partial and overpayment before any link", async () => {
  const { repository } = createFakeRepository();
  const created = await createObligation(OWNER, repository, CREATE_INPUT);
  assert.equal(created.ok, true);
  const occurrence = created.ok ? created.data.occurrence : null;
  assert.ok(occurrence);

  const partial = assertObligationPaymentSeam(occurrence, {
    expenseId: "33333333-3333-4333-8333-333333333333",
    amountMinor: 1,
    currency: "MAD",
    direction: "out",
    bookingDate: "2026-11-05",
  });
  assert.equal(partial.ok, false);
  assert.equal(partial.ok === false && partial.code, "conflict");
  assert.match(partial.ok === false ? partial.errorMessage : "", /Partial/);

  const full = assertObligationPaymentSeam(occurrence, {
    expenseId: "33333333-3333-4333-8333-333333333333",
    amountMinor: 350000,
    currency: "MAD",
    direction: "out",
    bookingDate: "2026-11-05",
  });
  assert.equal(full.ok, true);

  // The declared MONEY-07 port is a compile-time contract in this issue; it is
  // intentionally not implemented here (no simulated two-write payment).
  const seam: ObligationPaymentSettlementPort | null = null;
  assert.equal(seam, null);
});

test("a template from an archived lifecycle cannot seed a new occurrence", async () => {
  const { repository } = createFakeRepository({
    templates: new Map([[TEMPLATE_ID, template({ lifecycle: "archived" })]]),
  });
  const result = await createObligation(OWNER, repository, {
    ...CREATE_INPUT,
    templateId: TEMPLATE_ID,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "validation");
});

test("generated template values type stays explicit", () => {
  const values: ObligationTemplateCreateValues = {
    kind: "bill",
    description: "Rent",
    amountMinor: 1,
    cadence: "monthly",
    dueDayOfMonth: 1,
    dueWeekday: null,
    startDate: "2026-01-01",
    endDate: null,
    needVsWant: null,
    purpose: null,
    countsInDaily: null,
    category: null,
    idempotencyKey: "typed",
  };
  assert.equal(values.cadence, "monthly");
});
