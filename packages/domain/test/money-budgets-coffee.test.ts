import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPENSE_CATEGORY_REPORTING_GROUP,
  MONEY_HANDOFF_CATEGORY_MAPPING,
  MONEY_HANDOFF_SOURCE_LABELS,
  getCoffeeWeekWindow,
  parseMoneyBudgetPatchInput,
  parseMoneyBudgetPlanSaveInput,
  parseMoneyCoffeeVisitInput,
  parseMoneyCoffeeVisitListInput,
  parseMoneyExpenseClassificationInput,
  resolveCategoryBudgetPrecedence,
  resolveHandoffSourceLabel,
  summarizeCoffeeWindow,
} from "../src/money";
import { EXPENSE_CATEGORY_VALUES } from "../src/expenses";

test("publishes one explicit mapping for every handoff label", () => {
  assert.equal(MONEY_HANDOFF_CATEGORY_MAPPING.length, MONEY_HANDOFF_SOURCE_LABELS.length);
  const byLabel = new Map(
    MONEY_HANDOFF_CATEGORY_MAPPING.map((mapping) => [mapping.sourceLabel, mapping]),
  );
  for (const label of MONEY_HANDOFF_SOURCE_LABELS) {
    assert.ok(byLabel.has(label), `missing mapping for ${label}`);
  }
  assert.equal(byLabel.get("Start")?.meaning, "opening");
  assert.equal(byLabel.get("Income")?.meaning, "income");
  assert.equal(byLabel.get("Saving")?.meaning, "savings_transfer");
  assert.equal(byLabel.get("Food")?.category, "groceries");
  assert.equal(byLabel.get("Daily usage")?.reportingGroup, "daily_usage");
  assert.equal(byLabel.get("Personal care")?.reportingGroup, "personal_care");
  assert.equal(byLabel.get("Work/tools")?.reportingGroup, "work_tools");
  assert.equal(byLabel.get("Fun")?.reportingGroup, "fun");
  assert.equal(byLabel.get("Emergency")?.purpose, "emergency");
  assert.equal(byLabel.get("Emergency")?.countsInDailyDefault, true);
  assert.equal(byLabel.get("Bill")?.purpose, "fixed");
});

test("unsupported source labels keep their original text instead of collapsing into other", () => {
  const resolved = resolveHandoffSourceLabel("Pet supplies");
  assert.equal(resolved.known, false);
  if (resolved.known) return;
  assert.equal(resolved.preservedSourceLabel, "Pet supplies");
  assert.equal(resolved.fallbackCategory, "other");
  assert.equal(resolved.fallbackReportingGroup, "other");
});

test("every category keeps a distinguishable reporting group", () => {
  assert.deepEqual(
    [...EXPENSE_CATEGORY_VALUES].sort(),
    Object.keys(EXPENSE_CATEGORY_REPORTING_GROUP).sort(),
  );
  assert.equal(EXPENSE_CATEGORY_REPORTING_GROUP.groceries, "food");
  assert.equal(EXPENSE_CATEGORY_REPORTING_GROUP.eating_out, "food");
  assert.equal(EXPENSE_CATEGORY_REPORTING_GROUP.subscriptions, "bills");
  assert.equal(EXPENSE_CATEGORY_REPORTING_GROUP.household, "daily_usage");
  assert.equal(EXPENSE_CATEGORY_REPORTING_GROUP.daily_usage, "daily_usage");
  assert.notEqual(
    EXPENSE_CATEGORY_REPORTING_GROUP.personal_care,
    EXPENSE_CATEGORY_REPORTING_GROUP.other,
  );
});

test("budget save rejects negative/float amounts and invalid periods", () => {
  const valid = parseMoneyBudgetPlanSaveInput({
    periodStartDate: "2026-11-01",
    periodEndDate: "2026-11-30",
    allocations: { coffee: 0, groceries: 50_000 },
    savingsTargetMinor: 20_000,
    emergencyTargetMinor: null,
    coffeeWeeklySpendLimitMinor: 7_000,
    coffeeWeeklyVisitLimit: 5,
    version: 0,
  });
  assert.equal(valid.ok, true);

  const floatAmount = parseMoneyBudgetPlanSaveInput({
    periodStartDate: "2026-11-01",
    periodEndDate: "2026-11-30",
    allocations: { coffee: 1.5 },
    version: 0,
  });
  assert.equal(floatAmount.ok, false);
  if (!floatAmount.ok) assert.equal(floatAmount.field, "allocations");

  const backwards = parseMoneyBudgetPlanSaveInput({
    periodStartDate: "2026-11-30",
    periodEndDate: "2026-11-01",
    allocations: {},
    version: 0,
  });
  assert.equal(backwards.ok, false);
});

test("allocation patch distinguishes unchanged fields from explicit null clears", () => {
  const patch = parseMoneyBudgetPatchInput({
    periodStartDate: "2026-11-01",
    periodEndDate: "2026-11-30",
    version: 2,
    allocations: { coffee: null, groceries: 1_500 },
    savingsTargetMinor: null,
  });
  assert.equal(patch.ok, true);
  if (!patch.ok) return;
  assert.deepEqual(patch.value.allocations, { coffee: null, groceries: 1_500 });
  assert.equal(patch.value.savingsTargetMinor, null);
  assert.equal("emergencyTargetMinor" in patch.value, false);

  const empty = parseMoneyBudgetPatchInput({
    periodStartDate: "2026-11-01",
    periodEndDate: "2026-11-30",
    version: 2,
  });
  assert.equal(empty.ok, false);
});

test("period allocation takes precedence over an advisory cap without sharing an owner", () => {
  const withBoth = resolveCategoryBudgetPrecedence("coffee", 10_000, 8_000);
  assert.equal(withBoth.targetMinor, 10_000);
  assert.equal(withBoth.targetSource, "period_allocation");
  assert.equal(withBoth.advisoryCapMinor, 8_000);
  assert.equal(withBoth.allocationLabel, "Period budget allocation");
  assert.equal(withBoth.advisoryCapLabel, "Advisory monthly category cap");

  const capOnly = resolveCategoryBudgetPrecedence("coffee", null, 8_000);
  assert.equal(capOnly.targetMinor, 8_000);
  assert.equal(capOnly.targetSource, "advisory_cap");

  const none = resolveCategoryBudgetPrecedence("coffee", null, null);
  assert.equal(none.targetMinor, null);
  assert.equal(none.targetSource, "none");
});

test("coffee visit parser dedupes lines and sorts a stable replay payload", () => {
  const parsed = parseMoneyCoffeeVisitInput({
    visitKey: " visit-1 ",
    localDate: "2026-11-09",
    timezone: "Africa/Casablanca",
    expenseIds: [
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    ],
    note: "  two coffees ",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.visitKey, "visit-1");
  assert.deepEqual(parsed.value.expenseIds, [
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  ]);
  assert.equal(parsed.value.note, "two coffees");

  const invalid = parseMoneyCoffeeVisitInput({
    visitKey: "visit-1",
    localDate: "2026-11-09",
    timezone: "Africa/Casablanca",
    expenseIds: [],
  });
  assert.equal(invalid.ok, false);
});

test("budget save requires an allocations object and empty patches do not advance", () => {
  const save = parseMoneyBudgetPlanSaveInput({
    periodStartDate: "2026-11-09",
    periodEndDate: "2026-11-30",
    version: 1,
  });
  assert.equal(save.ok, false);
  if (!save.ok) assert.match(save.message, /allocations/i);

  const patch = parseMoneyBudgetPatchInput({
    periodStartDate: "2026-11-09",
    periodEndDate: "2026-11-30",
    version: 1,
    allocations: {},
  });
  assert.equal(patch.ok, false);
});

test("coffee week rejects a selected date outside the period", () => {
  assert.throws(
    () =>
      getCoffeeWeekWindow({
        localDate: "2026-11-09",
        timezone: "Africa/Casablanca",
        periodStartDate: "2026-11-11",
        periodEndDate: "2026-11-30",
      }),
    /outside the period/,
  );
});

test("coffee visit list accepts canonical integer query strings", () => {
  const parsed = parseMoneyCoffeeVisitListInput({
    from: "2026-11-09",
    to: "2026-11-15",
    limit: "50",
    offset: "10",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.limit, 50);
  assert.equal(parsed.value.offset, 10);
  for (const bad of ["1.5", "-1", "", "01"]) {
    const rejected = parseMoneyCoffeeVisitListInput({
      from: "2026-11-09",
      to: "2026-11-15",
      limit: bad,
    });
    assert.equal(rejected.ok, false, `limit ${JSON.stringify(bad)} must be rejected`);
  }
});

test("coffee week clips to a partial period and keeps counts/spend/remaining/overshoot distinct", () => {
  const window = getCoffeeWeekWindow({
    localDate: "2026-11-11",
    timezone: "Africa/Casablanca",
    periodStartDate: "2026-11-11",
    periodEndDate: "2026-11-30",
  });
  assert.equal(window.weekStart, "2026-11-11");
  assert.equal(window.weekEnd, "2026-11-15");
  assert.equal(window.clippedToPeriod, true);

  const summary = summarizeCoffeeWindow({
    window,
    truncated: false,
    countedVisitCount: 6,
    countedVisitSpendMinor: 12_000,
    categoryCoffeeSpendMinor: 15_000,
    spendLimitMinor: 10_000,
    visitLimit: 5,
  });
  assert.equal(summary.countedVisitCount, 6);
  assert.equal(summary.countedVisitSpendMinor, 12_000);
  assert.equal(summary.remainingSpendMinor, 0);
  assert.equal(summary.spendOvershootMinor, 2_000);
  assert.equal(summary.remainingVisits, 0);
  assert.equal(summary.visitOvershoot, 1);
  assert.equal(summary.categoryCoffeeSpendMinor, 15_000);
  assert.equal(summary.uncountedCategoryCoffeeSpendMinor, 3_000);
});

test("classification validates a versioned explicit category change", () => {
  const parsed = parseMoneyExpenseClassificationInput({
    expenseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    version: 3,
    category: "groceries",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.category, "groceries");
  assert.equal(parsed.value.note, undefined);

  const invalid = parseMoneyExpenseClassificationInput({
    expenseId: "not-a-uuid",
    version: 3,
    category: "groceries",
  });
  assert.equal(invalid.ok, false);
});
