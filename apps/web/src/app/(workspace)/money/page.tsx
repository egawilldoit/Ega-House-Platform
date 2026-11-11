import { redirect } from "next/navigation";
import {
  createAuthenticatedActor,
  getExpenseSummary,
  getMoneyBudgetPlan,
  getMoneyCoffeeWindow,
  listExpenses,
} from "@ega/application";
import {
  SupabaseExpenseRepository,
  SupabaseMoneyBudgetRepository,
  SupabaseMoneyCoffeeRepository,
} from "@ega/data-access";
import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import { MoneyCreatePanel } from "./_components/money-create-panel";
import { MoneyRowActions } from "./_components/money-row-actions";
import { CategoryCapsForm } from "./_components/category-caps-form";
import { BudgetPlanForm } from "./_components/budget-plan-form";
import { CoffeeVisitControls } from "./_components/coffee-visit-controls";
import {
  classifyExpenseCategoryAction,
  recordCoffeeVisitAction,
  saveBudgetPlanAction,
  saveCategoryCapsAction,
} from "./actions";
import { getWebUserPreferencesState } from "@/lib/services/user-preferences-service";
import { getLocalDateInTimezone } from "@ega/domain";
import {
  MONEY_ADVISORY_CAP_LABEL,
  MONEY_HANDOFF_CATEGORY_MAPPING,
  describeExpenseCategory,
} from "@ega/domain/money";
import { formatMinorToMad } from "@/lib/money/money-amount";
import type { ExpenseCategory } from "@ega/domain/expenses";

export const dynamic = "force-dynamic";
export const metadata = { title: "Money", description: "Your personal expense ledger." };

type Props = { searchParams: Promise<{ offset?: string }> };

function monthPeriod(localDate: string): { start: string; end: string } {
  const [year, month] = localDate.split("-").map(Number);
  const start = `${localDate.slice(0, 7)}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start,
    end: `${localDate.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`,
  };
}

function categoryLabel(category: ExpenseCategory): string {
  const description = describeExpenseCategory(category);
  return description.reportingGroupLabel === description.label
    ? description.label
    : `${description.reportingGroupLabel} · ${description.label}`;
}

export default async function MoneyPage({ searchParams }: Props) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/money");
  const params = await searchParams;
  const parsedOffset = /^\d+$/.test(params.offset ?? "") ? Number(params.offset) : 0;
  const offset = Number.isSafeInteger(parsedOffset) ? Math.min(parsedOffset, 100_000) : 0;
  const client = await createClient();
  let result;
  let timezone = "UTC";
  try {
    const time = await getWebTimeContext();
    timezone = time.timezone;
    result = await listExpenses(createAuthenticatedActor(user.id), new SupabaseExpenseRepository(client), { limit: "25", offset: String(offset) }, { timezone: time.timezone });
  } catch {
    result = null;
  }
  // Monthly caps are advisory progress targets in owner preferences.
  const prefsState = await getWebUserPreferencesState().catch(() => null);
  const caps = prefsState?.preferences.categoryCaps ?? {};
  // Actual spending summaries from the canonical ledger (PO-09), computed
  // server-side in bounded pages. Failures render as unavailable, never zero.
  const localToday = getLocalDateInTimezone(new Date(), timezone);
  const summaryResult = await getExpenseSummary(
    createAuthenticatedActor(user.id),
    new SupabaseExpenseRepository(client),
    { localDate: localToday, timezone },
  ).catch(() => null);
  const summary = summaryResult?.ok ? summaryResult.data : null;
  // Period plan and counted coffee use the same owner-local month until the
  // MONEY-03 period row is merged; both reads are explicit and fail as
  // "unavailable", never as invented zeros.
  const period = monthPeriod(localToday);
  const budgetResult = await getMoneyBudgetPlan(
    createAuthenticatedActor(user.id),
    new SupabaseMoneyBudgetRepository(client),
    { periodStartDate: period.start, periodEndDate: period.end },
  ).catch(() => null);
  const budgetPlan = budgetResult?.ok ? budgetResult.data : null;
  const coffeeWindowResult = await getMoneyCoffeeWindow(
    createAuthenticatedActor(user.id),
    {
      expenses: new SupabaseExpenseRepository(client),
      coffee: new SupabaseMoneyCoffeeRepository(client),
    },
    {
      localDate: localToday,
      timezone,
      periodStartDate: period.start,
      periodEndDate: period.end,
      spendLimitMinor: budgetPlan?.coffeeWeeklySpendLimitMinor ?? null,
      visitLimitMinor: budgetPlan?.coffeeWeeklyVisitLimit ?? null,
    },
  ).catch(() => null);
  const coffeeWindow = coffeeWindowResult?.ok ? coffeeWindowResult.data : null;
  const spentByCategory = summary?.monthToDate.totalsByCategory ?? {};
  const capsNote = summary
    ? summary.monthToDate.truncated
      ? "Cap progress is a lower bound (over 10,000 expenses this month)."
      : null
    : "Spending summaries unavailable right now.";
  const cappedCategories = Object.entries(caps).filter(
    ([, cap]) => typeof cap === "number",
  ) as Array<[ExpenseCategory, number]>;
  return <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
    <WorkspacePageHeader title="Money" description="Your personal expense ledger." />

    <section aria-labelledby="money-summary-heading" className="mt-6 rounded-lg border border-ega-border p-5">
      <h2 id="money-summary-heading" className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]">
        Recorded spending
      </h2>
      {summary ? (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Today</dt>
              <dd className="text-[length:var(--text-body)] font-medium">
                {new Intl.NumberFormat("fr-MA", { style: "currency", currency: "MAD", minimumFractionDigits: 2 }).format(summary.day.totalMinor / 100)}
                <span className="block text-[length:var(--text-meta)] font-normal text-[color:var(--ega-text-secondary)]">{summary.day.recordCount} recorded</span>
              </dd>
            </div>
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">This week</dt>
              <dd className="text-[length:var(--text-body)] font-medium">
                {new Intl.NumberFormat("fr-MA", { style: "currency", currency: "MAD", minimumFractionDigits: 2 }).format(summary.weekToDate.totalMinor / 100)}
                <span className="block text-[length:var(--text-meta)] font-normal text-[color:var(--ega-text-secondary)]">{summary.weekToDate.recordCount} recorded</span>
              </dd>
            </div>
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">This month</dt>
              <dd className="text-[length:var(--text-body)] font-medium">
                {new Intl.NumberFormat("fr-MA", { style: "currency", currency: "MAD", minimumFractionDigits: 2 }).format(summary.monthToDate.totalMinor / 100)}
                <span className="block text-[length:var(--text-meta)] font-normal text-[color:var(--ega-text-secondary)]">{summary.monthToDate.recordCount} recorded{summary.monthToDate.truncated ? " (lower bound)" : ""}</span>
              </dd>
            </div>
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Coffee this month</dt>
              <dd className="text-[length:var(--text-body)] font-medium">
                {new Intl.NumberFormat("fr-MA", { style: "currency", currency: "MAD", minimumFractionDigits: 2 }).format(summary.coffee.totalMinor / 100)}
                <span className="block text-[length:var(--text-meta)] font-normal text-[color:var(--ega-text-secondary)]">{summary.coffee.recordCount} recorded</span>
              </dd>
            </div>
          </dl>
          {summary.monthToDate.recordCount === 0 ? (
            <p className="mt-3 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
              Nothing recorded this month yet. Totals show recorded MAD only — they do not claim you spent nothing.
            </p>
          ) : null}
          {Object.keys(summary.monthToDate.totalsByCategory).length > 0 ? (
            <ul className="mt-3 flex flex-col gap-1.5">
              {Object.entries(summary.monthToDate.totalsByCategory)
                .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                .map(([category, minor]) => (
                  <li key={category} className="flex flex-wrap items-baseline gap-x-3 text-[length:var(--text-body)]">
                    <span className="font-medium">{categoryLabel(category as ExpenseCategory)}</span>
                    <span>
                      {new Intl.NumberFormat("fr-MA", { style: "currency", currency: "MAD", minimumFractionDigits: 2 }).format((minor ?? 0) / 100)}
                    </span>
                  </li>
                ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          Spending summaries unavailable right now. Your ledger below is unaffected.
        </p>
      )}
    </section>

    <section aria-labelledby="money-budget-heading" className="mt-6 rounded-lg border border-ega-border p-5">
      <h2 id="money-budget-heading" className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]">
        Period budget plan
      </h2>
      <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
        Period allocations and savings/emergency targets are editable plan
        values, separate from advisory category caps below.
      </p>
      {budgetResult && !budgetResult.ok ? (
        <p role="alert" className="mt-3 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          The period plan could not be loaded. Editing is unavailable right now; spending stays unaffected.
        </p>
      ) : (
        <div className="mt-4">
          <BudgetPlanForm
            plan={budgetPlan}
            periodStartDate={period.start}
            periodEndDate={period.end}
            action={saveBudgetPlanAction}
          />
        </div>
      )}
      {budgetPlan && Object.keys(budgetPlan.allocations).length > 0 ? (
        <div className="mt-5">
          <h3 className="text-[length:var(--text-body)] font-medium">Plan consumption</h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {(Object.entries(budgetPlan.allocations) as Array<[ExpenseCategory, number]>)
              .sort((a, b) => b[1] - a[1])
              .map(([category, allocation]) => {
                const spent =
                  category === "coffee"
                    ? coffeeWindow?.countedVisitSpendMinor ?? spentByCategory.coffee ?? 0
                    : spentByCategory[category] ?? 0;
                const over = spent > allocation;
                return (
                  <li key={category} className="flex flex-wrap items-baseline gap-x-3 text-[length:var(--text-body)]">
                    <span className="font-medium">{categoryLabel(category)}</span>
                    <span>{formatMinorToMad(spent)} / {formatMinorToMad(allocation)}</span>
                    {over ? (
                      <span className="text-[length:var(--text-meta)] text-[color:var(--ega-danger)]">
                        Over allocation — visible, never blocked.
                      </span>
                    ) : null}
                  </li>
                );
              })}
          </ul>
          <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Coffee consumption uses counted-visit amounts. Category-coffee spending
            is reported separately above.
          </p>
        </div>
      ) : null}
    </section>

    <section aria-labelledby="money-coffee-heading" className="mt-6 rounded-lg border border-ega-border p-5">
      <h2 id="money-coffee-heading" className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]">
        Counted coffee this week
      </h2>
      {coffeeWindow ? (
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Counted visits</dt>
            <dd className="font-medium">{coffeeWindow.countedVisitCount}{coffeeWindow.visitLimit !== null ? ` / ${coffeeWindow.visitLimit}` : ""}</dd>
          </div>
          <div>
            <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Counted visit spend</dt>
            <dd className="font-medium">{formatMinorToMad(coffeeWindow.countedVisitSpendMinor)}</dd>
          </div>
          <div>
            <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Remaining visits</dt>
            <dd className="font-medium">{coffeeWindow.remainingVisits === null ? "No limit" : coffeeWindow.remainingVisits}</dd>
          </div>
          <div>
            <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Remaining spend</dt>
            <dd className="font-medium">{coffeeWindow.remainingSpendMinor === null ? "No limit" : formatMinorToMad(coffeeWindow.remainingSpendMinor)}</dd>
          </div>
          <div>
            <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Spend overshoot</dt>
            <dd className="font-medium">{coffeeWindow.spendOvershootMinor === null ? "No limit" : formatMinorToMad(coffeeWindow.spendOvershootMinor)}</dd>
          </div>
          <div>
            <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Visit overshoot</dt>
            <dd className="font-medium">{coffeeWindow.visitOvershoot === null ? "No limit" : coffeeWindow.visitOvershoot}</dd>
          </div>
          <div>
            <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Category coffee (separate)</dt>
            <dd className="font-medium">{formatMinorToMad(coffeeWindow.categoryCoffeeSpendMinor)}</dd>
          </div>
          <div>
            <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Uncounted category coffee</dt>
            <dd className="font-medium">{formatMinorToMad(coffeeWindow.uncountedCategoryCoffeeSpendMinor)}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-3 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          Counted coffee usage is unavailable right now. Recorded expenses are unaffected.
        </p>
      )}
      {coffeeWindow ? (
        <p className="mt-3 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          Week {coffeeWindow.weekStart} to {coffeeWindow.weekEnd}
          {coffeeWindow.clippedToPeriod ? " (clipped to the selected period)" : ""}.
          {" "}{coffeeWindow.projectionNote}
          {coffeeWindow.truncated ? " This week hit the bounded scan cap; counts are a lower bound." : ""}
        </p>
      ) : null}
    </section>

    <section aria-labelledby="money-taxonomy-heading" className="mt-6 rounded-lg border border-ega-border p-5">
      <h2 id="money-taxonomy-heading" className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]">
        Category mapping
      </h2>
      <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
        One explicit handoff mapping. Start, Income and Saving are movements, not
        expense categories; each expense label keeps a distinct reporting group.
      </p>
      <ul className="mt-3 flex flex-col gap-1.5 text-[length:var(--text-meta)]">
        {MONEY_HANDOFF_CATEGORY_MAPPING.map((mapping) => (
          <li key={mapping.sourceLabel}>
            <span className="font-medium">{mapping.sourceLabel}</span>
            {" → "}
            {mapping.meaning === "expense"
              ? `${describeExpenseCategory(mapping.category!).reportingGroupLabel} · ${describeExpenseCategory(mapping.category!).label}`
              : `${mapping.meaning} movement`}
            {mapping.note ? ` — ${mapping.note}` : ""}
          </li>
        ))}
      </ul>
    </section>

    <section aria-labelledby="money-caps-heading" className="mt-6 rounded-lg border border-ega-border p-5">
      <h2 id="money-caps-heading" className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]">
        {MONEY_ADVISORY_CAP_LABEL}s
      </h2>
      <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
        Advisory caps only warn about progress. A period allocation in the plan
        above takes precedence for budget consumption; caps never rewrite an
        allocation and an allocation never rewrites a cap.
      </p>
      {cappedCategories.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1.5">
          {cappedCategories.map(([category, cap]) => {
            const spent = spentByCategory[category] ?? 0;
            const over = spent > cap;
            return (
              <li key={category} className="flex flex-wrap items-baseline gap-x-3 text-[length:var(--text-body)]">
                <span className="font-medium">{categoryLabel(category)}</span>
                <span>
                  {new Intl.NumberFormat("fr-MA", { style: "currency", currency: "MAD", minimumFractionDigits: 2 }).format(spent / 100)}
                  {" / "}
                  {new Intl.NumberFormat("fr-MA", { style: "currency", currency: "MAD", minimumFractionDigits: 2 }).format(cap / 100)}
                </span>
                {over ? (
                  <span className="text-[length:var(--text-meta)] text-[color:var(--ega-danger)]">
                    Over cap — advisory only, spending stays allowed.
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          No caps set. Expenses work either way.
        </p>
      )}
      {capsNote ? (
        <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">{capsNote}</p>
      ) : null}
      <div className="mt-4">
        <CategoryCapsForm caps={caps} action={saveCategoryCapsAction} returnTo="/money" />
      </div>
    </section>

    <MoneyCreatePanel ownerKey={user.id} />
    {(!result || !result.ok) ? <section role="alert" className="mt-6 rounded-lg border border-ega-border p-5">
      <p>Expenses could not be loaded.</p><a className="underline" href={`/money?offset=${offset}`}>Retry</a>
    </section> : result.data.expenses.length === 0 ? <section className="mt-6 rounded-lg border border-ega-border p-5"><p className="text-ega-text-secondary">{offset === 0 ? "No expenses yet." : "No expenses on this page."}</p>{offset > 0 && <a className="underline" href={`/money?offset=${Math.max(0, offset - 25)}`}>Previous page</a>}</section> : <>
      <div className="mt-6 overflow-x-auto rounded-lg border border-ega-border">
        <table className="w-full min-w-[50rem] text-left text-sm"><caption className="sr-only">Expenses</caption><thead><tr><th scope="col" className="p-3">Date</th><th scope="col" className="p-3">Merchant</th><th scope="col" className="p-3">Category</th><th scope="col" className="p-3">Need or want</th><th scope="col" className="p-3 text-right">Amount</th><th scope="col" className="p-3 text-right">Actions</th></tr></thead>
          <tbody>{result.data.expenses.map((expense) => (
            <tr key={expense.id} className="border-t border-ega-border">
              <td className="p-3">{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: timezone }).format(new Date(expense.occurredAt))}</td>
              <td className="p-3">{expense.merchant ?? "Expense"}{expense.note && <p className="mt-1 text-xs text-ega-text-secondary">{expense.note}</p>}</td>
              <td className="p-3">{categoryLabel(expense.category)}</td>
              <td className="p-3">{expense.needVsWant}</td>
              <td className="p-3 text-right tabular-nums">{new Intl.NumberFormat("fr-MA", { style: "currency", currency: "MAD", minimumFractionDigits: 2 }).format(expense.amountMinor / 100)}</td>
              <td className="p-3">
                <MoneyRowActions ownerKey={user.id} expense={expense} />
                {expense.category === "coffee" ? (
                  <div className="mt-2">
                    <CoffeeVisitControls
                      expenseId={expense.id}
                      version={expense.version}
                      recordVisit={recordCoffeeVisitAction}
                      classifyAsGroceries={classifyExpenseCategoryAction}
                    />
                  </div>
                ) : null}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <nav aria-label="Expense pages" className="mt-4 flex justify-between"><span>{offset > 0 && <a className="underline" href={`/money?offset=${Math.max(0, offset - 25)}`}>Previous</a>}</span><span>{result.data.pagination.hasMore && <a className="underline" href={`/money?offset=${offset + 25}`}>Next</a>}</span></nav>
    </>}
  </main>;
}
