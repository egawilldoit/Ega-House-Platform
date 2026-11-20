import assert from "node:assert/strict";
import test from "node:test";

import {
  OBLIGATION_KIND_DEFAULTS,
  addObligationPeriods,
  canonicalObligationCreatePayload,
  decideObligationTransition,
  dueDateForObligationPeriod,
  endOfObligationPeriod,
  listObligationPeriodStarts,
  obligationStateAtCutoff,
  parseCreateObligationInput,
  parseCreateObligationTemplateInput,
  parseObligationCutoffQuery,
  parseObligationListQuery,
  parseObligationTransitionInput,
  parseUpdateObligationInput,
  resolveObligationClassification,
  startOfObligationPeriod,
  summarizeObligationOccurrences,
  validateObligationPayment,
  validateObligationPeriod,
  type ObligationOccurrence,
  type ObligationTemplate,
} from "../src/obligations";

const UUID = "11111111-1111-4111-8111-111111111111";

function occurrence(
  overrides: Partial<ObligationOccurrence> = {},
): ObligationOccurrence {
  return {
    id: UUID,
    kind: "bill",
    description: "Rent",
    amountMinor: 350000,
    currency: "MAD",
    periodStart: "2026-11-01",
    periodEnd: "2026-11-30",
    dueDate: "2026-11-05",
    needVsWant: null,
    purpose: "fixed",
    countsInDaily: false,
    category: "bills",
    state: "pending",
    stateEffectiveDate: "2026-11-01",
    stateReason: null,
    paymentExpenseId: null,
    paymentEvidence: null,
    templateId: null,
    idempotencyKey: "occurrence-1",
    version: 1,
    createdAt: "2026-11-01T09:00:00.000Z",
    updatedAt: "2026-11-01T09:00:00.000Z",
    ...overrides,
  };
}

function template(overrides: Partial<ObligationTemplate> = {}): ObligationTemplate {
  return {
    id: UUID,
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
    purpose: "fixed",
    countsInDaily: false,
    category: "bills",
    lifecycle: "active",
    idempotencyKey: "template-1",
    version: 1,
    createdAt: "2026-01-01T09:00:00.000Z",
    updatedAt: "2026-01-01T09:00:00.000Z",
    ...overrides,
  };
}

test("classification precedence is payment > occurrence > template > kind default", () => {
  const templateSource = {
    needVsWant: "need" as const,
    purpose: "flexible" as const,
    countsInDaily: true,
    category: "household" as const,
  };

  // Template fills an occurrence that supplied nothing.
  const fromTemplate = resolveObligationClassification({
    kind: "bill",
    template: templateSource,
  });
  assert.deepEqual(fromTemplate, {
    needVsWant: "need",
    purpose: "flexible",
    countsInDaily: true,
    category: "household",
  });

  // Occurrence snapshot wins over the template.
  const fromOccurrence = resolveObligationClassification({
    kind: "bill",
    template: templateSource,
    occurrence: { needVsWant: "want", purpose: "fixed", countsInDaily: false },
  });
  assert.equal(fromOccurrence.needVsWant, "want");
  assert.equal(fromOccurrence.purpose, "fixed");
  assert.equal(fromOccurrence.countsInDaily, false);

  // Payment input wins over the occurrence snapshot.
  const fromPayment = resolveObligationClassification({
    kind: "bill",
    template: templateSource,
    occurrence: { needVsWant: "want", category: "household" },
    payment: { needVsWant: "need", category: "bills" },
  });
  assert.equal(fromPayment.needVsWant, "need");
  assert.equal(fromPayment.category, "bills");
});

test("need/want is never fabricated and kind defaults carry no need/want", () => {
  const resolved = resolveObligationClassification({ kind: "subscription" });
  assert.equal(resolved.needVsWant, null);
  assert.equal(resolved.purpose, OBLIGATION_KIND_DEFAULTS.subscription.purpose);
  assert.equal(
    resolved.countsInDaily,
    OBLIGATION_KIND_DEFAULTS.subscription.countsInDaily,
  );
  assert.equal(resolved.category, "subscriptions");
  assert.equal("needVsWant" in OBLIGATION_KIND_DEFAULTS.subscription, false);
});

test("recurrence periods and due dates are calendar-exact", () => {
  assert.equal(startOfObligationPeriod("2026-11-11", "monthly"), "2026-11-01");
  assert.equal(startOfObligationPeriod("2026-11-11", "quarterly"), "2026-10-01");
  assert.equal(startOfObligationPeriod("2026-11-11", "semiannual"), "2026-07-01");
  assert.equal(startOfObligationPeriod("2026-11-11", "annual"), "2026-01-01");
  // 2026-11-11 is a Wednesday; the week starts on Monday 2026-11-09.
  assert.equal(startOfObligationPeriod("2026-11-11", "weekly"), "2026-11-09");

  assert.equal(endOfObligationPeriod("2026-02-01", "monthly"), "2026-02-28");
  assert.equal(addObligationPeriods("2026-11-01", "monthly", 2), "2027-01-01");
  assert.equal(addObligationPeriods("2026-11-09", "weekly", 2), "2026-11-23");

  // A 31st-of-month bill is clamped in shorter months.
  assert.equal(
    dueDateForObligationPeriod(
      { cadence: "monthly", dueDayOfMonth: 31, dueWeekday: null },
      "2026-02-01",
    ),
    "2026-02-28",
  );
  assert.equal(
    dueDateForObligationPeriod(
      { cadence: "weekly", dueDayOfMonth: null, dueWeekday: 5 },
      "2026-11-09",
    ),
    "2026-11-13",
  );
});

test("generation plans are bounded and honour the template end date", () => {
  const plan = listObligationPeriodStarts(
    { cadence: "monthly", startDate: "2026-01-01", endDate: "2026-03-31" },
    "2026-12-31",
    24,
  );
  assert.deepEqual(plan.periodStarts, ["2026-01-01", "2026-02-01", "2026-03-01"]);
  assert.equal(plan.truncated, false);

  const capped = listObligationPeriodStarts(
    { cadence: "monthly", startDate: "2026-01-01", endDate: null },
    "2026-12-31",
    3,
  );
  assert.equal(capped.periodStarts.length, 3);
  assert.equal(capped.truncated, true);

  const none = listObligationPeriodStarts(
    { cadence: "monthly", startDate: "2026-06-01", endDate: null },
    "2026-05-31",
  );
  assert.deepEqual(none, { periodStarts: [], truncated: false });
});

test("lifecycle allows explicit cancel/waive/reopen but never a status-only payment", () => {
  assert.deepEqual(
    decideObligationTransition({
      from: "pending",
      to: "cancelled",
      effectiveDate: "2026-11-11",
      currentEffectiveDate: "2026-11-01",
    }),
    { ok: true },
  );
  assert.deepEqual(
    decideObligationTransition({
      from: "pending",
      to: "waived",
      effectiveDate: "2026-11-11",
      currentEffectiveDate: "2026-11-01",
    }),
    { ok: true },
  );
  assert.deepEqual(
    decideObligationTransition({
      from: "cancelled",
      to: "pending",
      effectiveDate: "2026-11-12",
      currentEffectiveDate: "2026-11-11",
    }),
    { ok: true },
  );

  const payment = decideObligationTransition({
    from: "pending",
    to: "paid",
    effectiveDate: "2026-11-11",
    currentEffectiveDate: "2026-11-01",
  });
  assert.equal(payment.ok, false);
  assert.equal(payment.ok === false && payment.reason, "payment_required");

  const leavingPaid = decideObligationTransition({
    from: "paid",
    to: "pending",
    effectiveDate: "2026-11-11",
    currentEffectiveDate: "2026-11-05",
  });
  assert.equal(leavingPaid.ok, false);
  assert.equal(
    leavingPaid.ok === false && leavingPaid.reason,
    "payment_resolution_required",
  );

  const noChange = decideObligationTransition({
    from: "pending",
    to: "pending",
    effectiveDate: "2026-11-11",
    currentEffectiveDate: "2026-11-01",
  });
  assert.equal(noChange.ok, false);
  assert.equal(noChange.ok === false && noChange.reason, "no_change");

  const backdated = decideObligationTransition({
    from: "waived",
    to: "pending",
    effectiveDate: "2026-10-31",
    currentEffectiveDate: "2026-11-11",
  });
  assert.equal(backdated.ok, false);
  assert.equal(
    backdated.ok === false && backdated.reason,
    "invalid_effective_date",
  );
});

test("cutoff totals use complete occurrences and reconstruct effective state", () => {
  const totals = summarizeObligationOccurrences(
    [
      occurrence({ id: UUID, dueDate: "2026-11-11", amountMinor: 10000 }),
      occurrence({
        id: "22222222-2222-4222-8222-222222222222",
        dueDate: "2026-11-01",
        amountMinor: 5000,
      }),
      occurrence({
        id: "33333333-3333-4333-8333-333333333333",
        dueDate: "2026-11-10",
        amountMinor: 7000,
        state: "paid",
        stateEffectiveDate: "2026-11-09",
        paymentExpenseId: "44444444-4444-4444-8444-444444444444",
      }),
      occurrence({
        id: "55555555-5555-4555-8555-555555555555",
        dueDate: "2026-11-11",
        amountMinor: 9000,
        state: "waived",
        stateEffectiveDate: "2026-11-11",
      }),
      occurrence({
        id: "66666666-6666-4666-8666-666666666666",
        dueDate: "2026-12-01",
        amountMinor: 99000,
      }),
    ],
    "2026-11-11",
  );

  assert.equal(totals.cutoffDate, "2026-11-11");
  assert.equal(totals.dueMinor, 10000);
  assert.equal(totals.overdueMinor, 5000);
  assert.equal(totals.outstandingMinor, 15000);
  assert.equal(totals.paidMinor, 7000);
  assert.equal(totals.pendingCount, 2);
  assert.equal(totals.overdueCount, 1);
  assert.equal(totals.paidCount, 1);
  assert.equal(totals.waivedCount, 1);
  assert.equal(totals.occurrenceCount, 4);
  assert.equal(totals.truncated, false);

  // Before its payment date the same occurrence was still outstanding, not
  // paid: the retained effective date reconstructs the prior state.
  const earlier = summarizeObligationOccurrences(
    [
      occurrence({
        id: "33333333-3333-4333-8333-333333333333",
        dueDate: "2026-11-10",
        amountMinor: 7000,
        state: "paid",
        stateEffectiveDate: "2026-11-09",
        paymentExpenseId: "44444444-4444-4444-8444-444444444444",
      }),
    ],
    "2026-11-08",
  );
  assert.equal(earlier.paidMinor, 0);
  assert.equal(earlier.outstandingMinor, 0);
  assert.equal(earlier.occurrenceCount, 0);

  assert.equal(
    obligationStateAtCutoff(
      occurrence({ state: "paid", stateEffectiveDate: "2026-11-09" }),
      "2026-11-08",
    ),
    "pending",
  );
  assert.equal(
    obligationStateAtCutoff(
      occurrence({ state: "cancelled", stateEffectiveDate: "2026-11-09" }),
      "2026-11-10",
    ),
    "cancelled",
  );
});

test("create input requires a real period, integer centimes and no caller owner", () => {
  const valid = {
    kind: "bill",
    description: "Rent",
    amountMinor: 350000,
    dueDate: "2026-11-05",
    periodStart: "2026-11-01",
    periodEnd: "2026-11-30",
    stateEffectiveDate: "2026-11-01",
    idempotencyKey: "create-1",
  };
  const parsed = parseCreateObligationInput(valid);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ok && parsed.value.needVsWant, undefined);
  assert.equal(parsed.ok && parsed.value.purpose, undefined);
  assert.equal(parsed.ok && parsed.value.templateId, null);

  const ownerInjection = parseCreateObligationInput({
    ...valid,
    ownerUserId: UUID,
  });
  assert.equal(ownerInjection.ok, false);
  assert.equal(ownerInjection.ok === false && ownerInjection.field, "ownerUserId");

  const fractional = parseCreateObligationInput({ ...valid, amountMinor: 10.5 });
  assert.equal(fractional.ok, false);

  const dueOutside = parseCreateObligationInput({ ...valid, dueDate: "2026-12-05" });
  assert.equal(dueOutside.ok, false);
  assert.equal(dueOutside.ok === false && dueOutside.field, "dueDate");

  // periodStart/periodEnd default to the due date for a one-off bill.
  const oneOff = parseCreateObligationInput({
    kind: "bill",
    description: "Dentist",
    amountMinor: 20000,
    dueDate: "2026-11-20",
    stateEffectiveDate: "2026-11-11",
    idempotencyKey: "create-2",
  });
  assert.equal(oneOff.ok, true);
  assert.equal(oneOff.ok && oneOff.value.periodStart, "2026-11-20");
  assert.equal(oneOff.ok && oneOff.value.periodEnd, "2026-11-20");

  const missingEffective = parseCreateObligationInput({
    ...valid,
    stateEffectiveDate: undefined,
  });
  assert.equal(missingEffective.ok, false);

  assert.deepEqual(validateObligationPeriod("2026-11-30", "2026-11-01", "2026-11-05"), {
    ok: false,
    field: "periodEnd",
    message: "The period end must be on or after its start.",
  });
});

test("update and transition inputs require an expected version", () => {
  const update = parseUpdateObligationInput({ description: "Rent (new)" });
  assert.equal(update.ok, false);
  assert.equal(update.ok === false && update.field, "version");

  const okUpdate = parseUpdateObligationInput({
    version: 2,
    amountMinor: 360000,
    needVsWant: null,
  });
  assert.equal(okUpdate.ok, true);
  assert.equal(okUpdate.ok && okUpdate.value.expectedVersion, 2);
  assert.equal(okUpdate.ok && okUpdate.value.needVsWant, null);

  const emptyUpdate = parseUpdateObligationInput({ version: 2 });
  assert.equal(emptyUpdate.ok, false);

  const transition = parseObligationTransitionInput({
    version: 1,
    to: "waived",
    effectiveDate: "2026-11-11",
    reason: "Landlord waived the fee",
  });
  assert.equal(transition.ok, true);
  assert.equal(transition.ok && transition.value.to, "waived");
  assert.equal(transition.ok && transition.value.reason, "Landlord waived the fee");

  const badState = parseObligationTransitionInput({
    version: 1,
    to: "deleted",
    effectiveDate: "2026-11-11",
  });
  assert.equal(badState.ok, false);
});

test("list and cutoff queries are bounded and reject unknown parameters", () => {
  const list = parseObligationListQuery({ kind: "bill", limit: "10" });
  assert.equal(list.ok, true);
  assert.equal(list.ok && list.value.limit, 10);
  assert.equal(list.ok && list.value.state, null);

  assert.equal(parseObligationListQuery({ limit: "101" }).ok, false);
  assert.equal(parseObligationListQuery({ limit: "0" }).ok, false);
  assert.equal(parseObligationListQuery({ dueFrom: "2026-12-01", dueTo: "2026-11-01" }).ok, false);
  assert.equal(parseObligationListQuery({ unexpected: "x" }).ok, false);
  assert.equal(parseObligationCutoffQuery({ cutoff: "2026-02-30" }).ok, false);
  assert.equal(parseObligationCutoffQuery({ cutoff: "2026-11-11" }).ok, true);
});

test("template input validates cadence-specific scheduling", () => {
  const monthly = parseCreateObligationTemplateInput({
    kind: "bill",
    description: "Internet",
    amountMinor: 29900,
    cadence: "monthly",
    dueDayOfMonth: 15,
    startDate: "2026-01-01",
    idempotencyKey: "template-create-1",
  });
  assert.equal(monthly.ok, true);
  assert.equal(monthly.ok && monthly.value.needVsWant, null);
  assert.equal(monthly.ok && monthly.value.purpose, null);
  assert.equal(monthly.ok && monthly.value.countsInDaily, null);

  const weeklyWithoutWeekday = parseCreateObligationTemplateInput({
    kind: "subscription",
    description: "Gym",
    amountMinor: 5000,
    cadence: "weekly",
    startDate: "2026-01-01",
    idempotencyKey: "template-create-2",
  });
  assert.equal(weeklyWithoutWeekday.ok, false);
  assert.equal(weeklyWithoutWeekday.ok === false && weeklyWithoutWeekday.field, "dueWeekday");

  const weekly = parseCreateObligationTemplateInput({
    kind: "subscription",
    description: "Gym",
    amountMinor: 5000,
    cadence: "weekly",
    dueWeekday: 1,
    startDate: "2026-01-01",
    idempotencyKey: "template-create-3",
  });
  assert.equal(weekly.ok, true);
  assert.equal(weekly.ok && weekly.value.dueDayOfMonth, null);
  assert.equal(weekly.ok && weekly.value.dueWeekday, 1);

  const bothSchedules = parseCreateObligationTemplateInput({
    kind: "bill",
    description: "Rent",
    amountMinor: 1000,
    cadence: "monthly",
    dueDayOfMonth: 1,
    dueWeekday: 1,
    startDate: "2026-01-01",
    idempotencyKey: "template-create-4",
  });
  assert.equal(bothSchedules.ok, false);
});

test("payment seam rejects partial, over and duplicate payments", () => {
  const pending = occurrence({ amountMinor: 10000 });
  assert.deepEqual(
    validateObligationPayment(pending, {
      expenseId: UUID,
      amountMinor: 10000,
      currency: "MAD",
      direction: "out",
      bookingDate: "2026-11-05",
    }),
    { ok: true },
  );

  const partial = validateObligationPayment(pending, {
    expenseId: UUID,
    amountMinor: 5000,
    currency: "MAD",
    direction: "out",
    bookingDate: "2026-11-05",
  });
  assert.equal(partial.ok, false);
  assert.equal(partial.ok === false && partial.reason, "partial_payment");

  const over = validateObligationPayment(pending, {
    expenseId: UUID,
    amountMinor: 10001,
    currency: "MAD",
    direction: "out",
    bookingDate: "2026-11-05",
  });
  assert.equal(over.ok, false);
  assert.equal(over.ok === false && over.reason, "overpayment");

  const settled = validateObligationPayment(
    occurrence({ state: "paid", stateEffectiveDate: "2026-11-05" }),
    {
      expenseId: UUID,
      amountMinor: 10000,
      currency: "MAD",
      direction: "out",
      bookingDate: "2026-11-05",
    },
  );
  assert.equal(settled.ok, false);
  assert.equal(settled.ok === false && settled.reason, "already_settled");
});

test("canonical create payload is stable and covers every semantic field", () => {
  const values = {
    kind: "bill" as const,
    description: "Rent",
    amountMinor: 350000,
    periodStart: "2026-11-01",
    periodEnd: "2026-11-30",
    dueDate: "2026-11-05",
    needVsWant: null,
    purpose: "fixed" as const,
    countsInDaily: false,
    category: "bills" as const,
    stateEffectiveDate: "2026-11-01",
    templateId: null,
    idempotencyKey: "canonical-1",
  };
  const base = canonicalObligationCreatePayload(values);
  assert.equal(canonicalObligationCreatePayload({ ...values }), base);
  assert.notEqual(
    canonicalObligationCreatePayload({ ...values, amountMinor: 350001 }),
    base,
  );
  assert.notEqual(
    canonicalObligationCreatePayload({ ...values, idempotencyKey: "canonical-2" }),
    base,
  );

  // Template row shape used by the classification source is usable as-is.
  assert.equal(template().kind, "bill");
});
