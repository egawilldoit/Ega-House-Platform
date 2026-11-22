import type { ApplicationResult, MoneyPeriodSpending } from "@ega/application";
import type { MoneyBudgetPlanDto, MoneyPeriodDto } from "@ega/contracts/money";
import type { ExpenseCategory } from "@ega/domain/expenses";
import {
  MONEY_HANDOFF_CATEGORY_MAPPING,
  describeExpenseCategory,
} from "@ega/domain/money";

import type { SaveBudgetPlanActionInput } from "../actions";
import { BudgetPlanForm } from "./budget-plan-form";
import { formatMad } from "./money-format";

type BudgetAction = (input: SaveBudgetPlanActionInput) => Promise<
  | { ok: true; plan: MoneyBudgetPlanDto }
  | { ok: false; code: string; error: string }
>;

/**
 * Period plan presentation. Consumption is the shared period spending read;
 * recording an expense never rewrites the plan, and a missing reading stays
 * unavailable rather than zero.
 */
export function MoneyBudgetPlanPanel({
  period,
  budget,
  spending,
  action,
}: {
  period: MoneyPeriodDto | null;
  budget: ApplicationResult<MoneyBudgetPlanDto | null> | null;
  spending: MoneyPeriodSpending | null;
  action: BudgetAction;
}) {
  if (!period) {
    return (
      <section aria-labelledby="money-budget-heading" className="mt-6 rounded-lg border border-ega-border p-5">
        <h2 id="money-budget-heading" className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]">
          Period budget plan
        </h2>
        <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          Create a tracking period first; a budget plan always belongs to one period.
        </p>
      </section>
    );
  }
  return (
    <section aria-labelledby="money-budget-heading" className="mt-6 rounded-lg border border-ega-border p-5">
      <h2 id="money-budget-heading" className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]">
        Period budget plan
      </h2>
      {budget && !budget.ok ? (
        <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          {budget.errorMessage} The ledger below is unaffected.
        </p>
      ) : null}
      <div className="mt-4">
        <BudgetPlanForm
          plan={budget?.ok ? (budget.data ?? null) : null}
          periodStartDate={period.startDate}
          periodEndDate={period.endDate}
          readOnly={period.lifecycle !== "tracking"}
          loadFailed={budget !== null && !budget.ok}
          action={action}
        />
      </div>
      {budget?.ok && budget.data && Object.keys(budget.data.allocations).length > 0 ? (
        <>
          {spending === null ? (
            <p className="mt-4 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
              Period spending is unavailable right now; allocation progress is not shown as zero.
            </p>
          ) : null}
          <ul className="mt-4 flex flex-col gap-1.5">
            {(Object.entries(budget.data.allocations) as Array<[ExpenseCategory, number]>)
              .sort((a, b) => b[1] - a[1])
              .map(([category, allocation]) => {
                const categoryTotal = spending?.totalsByCategory[category];
                const completePeriodSummary = spending !== null && !spending.truncated;
                const spent = categoryTotal ?? (completePeriodSummary ? 0 : null);
                const truncated = spending?.truncated ?? false;
                return (
                  <li key={category} className="flex flex-wrap items-baseline gap-x-3 text-[length:var(--text-body)]">
                    <span className="font-medium">{describeExpenseCategory(category).label}</span>
                    {spent === null ? (
                      <span className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                        Spending unavailable
                      </span>
                    ) : (
                      <span>
                        {formatMad(spent)}
                        {truncated ? "+" : ""}
                        {" / "}
                        {formatMad(allocation)}
                      </span>
                    )}
                  </li>
                );
              })}
          </ul>
        </>
      ) : null}
      {spending?.truncated ? (
        <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          Period spending is a lower bound: the bounded summary limit was reached.
        </p>
      ) : null}
      <p className="mt-3 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
        Plan consumption compares recorded period spending with the period allocation; an
        allocation takes precedence over an advisory cap while both stay visible. Recording an
        expense never rewrites either value. Published handoff mapping covers{" "}
        {MONEY_HANDOFF_CATEGORY_MAPPING.length} source labels.
      </p>
    </section>
  );
}
