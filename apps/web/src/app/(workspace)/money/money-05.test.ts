import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const pageSource = readFileSync(resolve(import.meta.dirname, "./page.tsx"), "utf8");
const actionsSource = readFileSync(
  resolve(import.meta.dirname, "./actions.ts"),
  "utf8",
);
const budgetFormSource = readFileSync(
  resolve(import.meta.dirname, "./_components/budget-plan-form.tsx"),
  "utf8",
);
const budgetPanelSource = readFileSync(
  resolve(import.meta.dirname, "./_components/money-budget-plan-panel.tsx"),
  "utf8",
);
const overviewSource = readFileSync(
  resolve(import.meta.dirname, "./_components/money-overview-panels.tsx"),
  "utf8",
);

test("Money page exposes the editable period budget plan from shared use cases", () => {
  assert.match(pageSource, /getMoneyBudgetPlan\(/);
  assert.match(pageSource, /getMoneyPeriodSpending\(/);
  assert.match(pageSource, /getMoneyCoffeeVisitUsage\(/);
  assert.match(pageSource, /new SupabaseMoneyBudgetRepository\(client\)/);
  assert.match(pageSource, /MoneyBudgetPlanPanel/);
  assert.match(budgetPanelSource, /readOnly=\{period\.lifecycle !== "tracking"\}/);
  assert.match(budgetPanelSource, /MONEY_HANDOFF_CATEGORY_MAPPING/);
  assert.match(budgetPanelSource, /describeExpenseCategory\(/);
  assert.match(overviewSource, /MONEY_ADVISORY_CAP_LABEL/);
  assert.match(budgetPanelSource, /Plan consumption/);
  assert.match(budgetPanelSource, /countedVisitSpendMinor/);
  assert.doesNotMatch(pageSource, /owner_user_id\s*:/);
});

test("counted-visit coffee UI and web-only visit helpers are removed", () => {
  for (const source of [pageSource, actionsSource, budgetPanelSource, overviewSource]) {
    assert.doesNotMatch(source, /CoffeeVisitControls/);
    assert.doesNotMatch(source, /getMoneyCoffeeWindowForPlan/);

    assert.doesNotMatch(source, /recordCoffeeVisitAction/);
    assert.doesNotMatch(source, /classifyExpenseCategoryAction/);
    assert.doesNotMatch(source, /Counted coffee this week/);

  }
  // Category coffee remains an ordinary recorded expense projection.
  assert.match(overviewSource, /Coffee this month/);
  assert.match(overviewSource, /summary\.coffee\.totalMinor/);
});

test("Money actions use shared use cases with verified identity and no caller owner", () => {
  assert.match(actionsSource, /saveMoneyBudgetPlan\(/);
  assert.match(actionsSource, /getCurrentUser\(\)/);
  assert.match(actionsSource, /createAuthenticatedActor\(user\.id\)/);
  assert.match(actionsSource, /revalidatePath\("\/money"\)/);
  assert.doesNotMatch(actionsSource, /recordMoneyCoffeeVisit\(/);
  assert.doesNotMatch(actionsSource, /classifyMoneyExpense\(/);
  assert.doesNotMatch(actionsSource, /owner_user_id\s*:/);
});

test("budget form posts one versioned plan and distinguishes empty from zero", () => {
  assert.match(budgetFormSource, /MONEY_BUDGET_PERIOD_LABEL/);
  assert.match(budgetFormSource, /version/);
  assert.match(budgetFormSource, /allocations/);
  assert.match(budgetFormSource, /savingsTargetMinor/);
  assert.match(budgetFormSource, /emergencyTargetMinor/);
  assert.match(budgetFormSource, /coffeeWeeklySpendLimitMinor/);
  assert.match(budgetFormSource, /coffeeWeeklyVisitLimit/);
  assert.match(budgetFormSource, /Empty means not set; 0 is a deliberate zero/);
});
