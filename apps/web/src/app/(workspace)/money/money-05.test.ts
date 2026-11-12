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
const coffeeControlsSource = readFileSync(
  resolve(import.meta.dirname, "./_components/coffee-visit-controls.tsx"),
  "utf8",
);

test("Money page exposes editable period budget, coffee and mapping controls", () => {
  assert.match(pageSource, /getMoneyBudgetPlan\(/);
  assert.match(pageSource, /getMoneyCoffeeWindowForPlan\(/);
  assert.match(pageSource, /getMoneyPeriodSpending\(/);
  assert.match(pageSource, /new SupabaseMoneyBudgetRepository\(client\)/);
  assert.match(pageSource, /new SupabaseMoneyCoffeeRepository\(client\)/);
  assert.match(pageSource, /BudgetPlanForm/);
  assert.match(pageSource, /expense\.category === "coffee" \? <CoffeeVisitControls/);
  assert.match(pageSource, /readOnly=\{moneyState\.period\.lifecycle !== "tracking"\}/);
  assert.match(pageSource, /MONEY_HANDOFF_CATEGORY_MAPPING/);
  assert.match(pageSource, /describeExpenseCategory\(/);
  assert.match(pageSource, /MONEY_ADVISORY_CAP_LABEL/);
  assert.match(pageSource, /Counted coffee this week/);
  assert.match(pageSource, /Plan consumption/);
  assert.match(pageSource, /Coffee consumption uses counted-visit amounts/);
  assert.match(pageSource, /Category coffee \(separate\)/);
  assert.match(pageSource, /Uncounted category coffee/);
  assert.doesNotMatch(pageSource, /owner_user_id\s*:/);
});

test("Money actions use shared use cases with verified identity and no caller owner", () => {
  for (const call of [
    /saveMoneyBudgetPlan\(/,
    /recordMoneyCoffeeVisit\(/,
    /classifyMoneyExpense\(/,
  ]) {
    assert.match(actionsSource, call);
  }
  assert.match(actionsSource, /getCurrentUser\(\)/);
  assert.match(actionsSource, /createAuthenticatedActor\(user\.id\)/);
  assert.match(actionsSource, /revalidatePath\("\/money"\)/);
  assert.match(actionsSource, /coffee-expense-\$\{expense\.data\.id\}/);
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

test("coffee controls expose count-visit and classify-as-groceries without a new cash effect", () => {
  assert.match(coffeeControlsSource, /Count visit/);
  assert.match(coffeeControlsSource, /Classify as groceries/);
  assert.match(coffeeControlsSource, /recordVisit/);
  assert.match(coffeeControlsSource, /classifyAsGroceries/);
  assert.doesNotMatch(coffeeControlsSource, /createExpense/);
});
