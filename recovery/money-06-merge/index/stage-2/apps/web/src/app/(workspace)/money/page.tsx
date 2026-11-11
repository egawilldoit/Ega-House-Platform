import { redirect } from "next/navigation";
import {
  createAuthenticatedActor,
  getMoneyBudgetPlan,
  getMoneyCoffeeWindow,
  getMoneyMovementTotals,
  getMoneyState,
  listExpenses,
  listMovements,
  movementEffect,
  type MoneyMovementTotals,
  type MoneyState,
} from "@ega/application";
import {
  SupabaseExpenseRepository,
  SupabaseMoneyBudgetRepository,
  SupabaseMoneyCoffeeRepository,
  SupabaseMoneyPeriodRepository,
  SupabaseMoneyRepository,
} from "@ega/data-access";
import {
  MONEY_ADVISORY_CAP_LABEL,
  MONEY_DEFAULT_TIMEZONE,
  MONEY_HANDOFF_CATEGORY_MAPPING,
  MONEY_TRACKED_CASH_BOUNDARY,
  describeExpenseCategory,
} from "@ega/domain/money";
import type { CoffeeWindowSummary, MoneyLedgerRow } from "@ega/domain/money";
import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import { RefreshOnFocus } from "@/components/refresh-on-focus";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import { MoneyCreatePanel } from "./_components/money-create-panel";
import { MoneyRowActions } from "./_components/money-row-actions";
import { MoneyPeriodPanel } from "./_components/money-period-panel";
import { MoneyMovementPanel } from "./_components/money-movement-panel";
import { MoneyMovementActions } from "./_components/money-movement-actions";
import { CategoryCapsForm } from "./_components/category-caps-form";
import { BudgetPlanForm } from "./_components/budget-plan-form";
import { CoffeeVisitControls } from "./_components/coffee-visit-controls";
import {
  classifyExpenseCategoryAction,
  createMoneyPeriodAction,
  recordCoffeeVisitAction,
  saveBudgetPlanAction,
  saveCategoryCapsAction,
  updateMoneySettingsAction,
} from "./actions";
import { getWebUserPreferencesState } from "@/lib/services/user-preferences-service";
import { getLocalDateInTimezone } from "@ega/domain";
import { getExpenseSummary } from "@ega/application";
import type { ExpenseCategory } from "@ega/domain/expenses";

export const dynamic = "force-dynamic";
export const metadata = { title: "Money", description: "Your personal expense ledger." };

function formatMad(minor: number): string {
  return new Intl.NumberFormat("fr-MA", {
    style: "currency",
    currency: "MAD",
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

function movementKindLabel(kind: string): string {
  return kind.replaceAll("_", " ");
}

type Props = { searchParams: Promise<{ offset?: string; periodId?: string }> };

export default async function MoneyPage({ searchParams }: Props) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/money");
  const params = await searchParams;
  const parsedOffset = /^\d+$/.test(params.offset ?? "") ? Number(params.offset) : 0;
  const offset = Number.isSafeInteger(parsedOffset) ? Math.min(parsedOffset, 100_000) : 0;
  const selectedPeriodId =
    typeof params.periodId === "string" && params.periodId.trim()
      ? params.periodId.trim()
      : null;
  const client = await createClient();
  const actor = createAuthenticatedActor(user.id);
  let result;
  let moneyState: MoneyState | null = null;
  let budgetResult: Awaited<ReturnType<typeof getMoneyBudgetPlan>> | null = null;
  let coffeeWindow: CoffeeWindowSummary | null = null;
  let movements: MoneyLedgerRow[] | null = null;
  let movementTotals: MoneyMovementTotals | null = null;
  let movementsHasMore = false;
  let timezone: string = MONEY_DEFAULT_TIMEZONE;
  let timeContextFailed = false;
  try {
    const time = await getWebTimeContext();
    timezone = time.persistedTimezone ?? MONEY_DEFAULT_TIMEZONE;
    result = await listExpenses(actor, new SupabaseExpenseRepository(client), { limit: "25", offset: String(offset) }, { timezone });
    // The period state is the shared owner context. A failed read renders as
    // unavailable rather than as an empty/invented period.
    const stateResult = await getMoneyState(
      actor,
      new SupabaseMoneyPeriodRepository(client),
      { periodId: selectedPeriodId ?? undefined },
      { now: new Date(), timezone: time.persistedTimezone },
    );
    moneyState = stateResult.ok ? stateResult.data : null;

    // MONEY-05 period plan and counted coffee. A plan belongs to the canonical
    // period; both reads fail closed instead of inventing zero values.
    const period = moneyState?.period ?? null;
    if (moneyState?.period) {
      const period = moneyState.period;
      budgetResult = await getMoneyBudgetPlan(
        actor,
        {
          budgets: new SupabaseMoneyBudgetRepository(client),
          periods: new SupabaseMoneyPeriodRepository(client),
        },
        { periodStartDate: period.startDate, periodEndDate: period.endDate },
      ).catch(() => null);
      const plan = budgetResult?.ok ? budgetResult.data : null;
      const coffeeResult = await getMoneyCoffeeWindow(
        actor,
        {
          expenses: new SupabaseExpenseRepository(client),
          coffee: new SupabaseMoneyCoffeeRepository(client),
        },
        {
          localDate: moneyState.localToday,
          timezone,
          periodStartDate: period.startDate,
          periodEndDate: period.endDate,
          spendLimitMinor: plan?.coffeeWeeklySpendLimitMinor ?? null,
          visitLimitMinor: plan?.coffeeWeeklyVisitLimit ?? null,
        },
      ).catch(() => null);
      coffeeWindow = coffeeResult?.ok ? coffeeResult.data : null;
    }

    // MONEY-04 movement ledger: the same canonical rows and totals as HTTP/MCP.
    // Failures render as unavailable, never as a confirmed zero balance.
    const moneyRepository = new SupabaseMoneyRepository(client);
    const movementsResult = await listMovements(
      actor,
      moneyRepository,
      { limit: "25", offset: String(offset) },
      { timezone },
    ).catch(() => null);
    // Expenses are managed in the expense table above; the movement ledger
    // below shows non-expense movements so one purchase is never rendered twice.
    movements = movementsResult?.ok
      ? movementsResult.data.movements.filter(
          (movement) => movement.kind !== "expense",
        )
      : null;
    movementsHasMore = movementsResult?.ok
      ? movementsResult.data.pagination.hasMore
      : false;
    const cutoff =
      moneyState?.cash.cutoffDate ??
      moneyState?.dateResolution.resolvedDate ??
      getLocalDateInTimezone(new Date(), timezone);
    const totalsResult = await getMoneyMovementTotals(
      actor,
      moneyRepository,
      { cutoff },
      {
        cutoff,
        startDate: moneyState?.period?.startDate ?? null,
        timezone,
      },
    ).catch(() => null);
    movementTotals = totalsResult?.ok ? totalsResult.data.totals : null;
  } catch {
    result = null;
    moneyState = null;
    budgetResult = null;
    coffeeWindow = null;
    movements = null;
    movementTotals = null;
    timeContextFailed = true;
  }
  // Monthly caps are advisory progress targets in owner preferences.
  const prefsState = await getWebUserPreferencesState().catch(() => null);
  const caps = prefsState?.preferences.categoryCaps ?? {};
  // Actual spending summaries from the canonical ledger (PO-09), computed
  // server-side in bounded pages. Failures render as unavailable, never zero.
  // A time-context outage makes the cutoff ambiguous; report the summary as
  // unavailable rather than presenting a default-timezone total as Today.
  const localToday = getLocalDateInTimezone(new Date(), timezone);
  const summaryResult = timeContextFailed
    ? null
    : await getExpenseSummary(
        createAuthenticatedActor(user.id),
        new SupabaseExpenseRepository(client),
        { localDate: localToday, timezone },
      ).catch(() => null);
  const summary = summaryResult?.ok ? summaryResult.data : null;
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

    {moneyState ? (
      <MoneyPeriodPanel
        key={`${moneyState.period?.id ?? "none"}:${moneyState.period?.version ?? 0}`}
        localToday={moneyState.localToday}
        timezone={moneyState.timezone}
        period={moneyState.period}
        opening={moneyState.opening}
        cash={moneyState.cash}
        history={moneyState.history}
        legacyReviewRequired={
          moneyState.legacy.available && moneyState.legacy.reviewRequired
        }
        selectedPeriodId={selectedPeriodId}
        createAction={createMoneyPeriodAction}
        updateAction={updateMoneySettingsAction}
      />
    ) : (
      <section role="alert" className="mt-6 rounded-lg border border-ega-border p-5">
        <h2 className="text-[length:var(--text-section)] font-semibold">
          Tracking period unavailable
        </h2>
        <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          Money state could not be loaded. Your ledger below is unaffected.
        </p>
        <a className="mt-2 inline-block underline" href="/money">
          Retry
        </a>
      </section>
    )}

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
                <span className="block text-[length:var(--text-meta)] font-normal text-[color:var(--ega-text-secondary)]">{summary.day.recordCount} recorded{summary.day.truncated ? " (lower bound)" : ""}</span>
              </dd>
            </div>
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">This week</dt>
              <dd className="text-[length:var(--text-body)] font-medium">
                {new Intl.NumberFormat("fr-MA", { style: "currency", currency: "MAD", minimumFractionDigits: 2 }).format(summary.weekToDate.totalMinor / 100)}
                <span className="block text-[length:var(--text-meta)] font-normal text-[color:var(--ega-text-secondary)]">{summary.weekToDate.recordCount} recorded{summary.weekToDate.truncated ? " (lower bound)" : ""}</span>
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
                <span className="block text-[length:var(--text-meta)] font-normal text-[color:var(--ega-text-secondary)]">{summary.coffee.recordCount} recorded{summary.coffee.truncated ? " (lower bound)" : ""}</span>
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
                    <span className="font-medium">{category.replaceAll("_", " ")}</span>
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
      {moneyState?.period ? (
        <>
          {budgetResult && !budgetResult.ok ? (
            <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
              {budgetResult.errorMessage} The ledger below is unaffected.
            </p>
          ) : null}
          <div className="mt-4">
            <BudgetPlanForm
              plan={budgetResult?.ok ? budgetResult.data : null}
              periodStartDate={moneyState.period.startDate}
              periodEndDate={moneyState.period.endDate}
              action={saveBudgetPlanAction}
            />
          </div>
          {budgetResult?.ok && budgetResult.data && Object.keys(budgetResult.data.allocations).length > 0 ? (
            <ul className="mt-4 flex flex-col gap-1.5">
              {(Object.entries(budgetResult.data.allocations) as Array<[ExpenseCategory, number]>)
                .sort((a, b) => b[1] - a[1])
                .map(([category, allocation]) => {
                  // Coffee consumption follows counted-visit amounts; other
                  // categories use the canonical category total. The difference
                  // between counted and category coffee is stated, not erased.
                  const spent =
                    category === "coffee"
                      ? coffeeWindow?.countedVisitSpendMinor ?? spentByCategory.coffee ?? 0
                      : spentByCategory[category] ?? 0;
                  return (
                    <li key={category} className="flex flex-wrap items-baseline gap-x-3 text-[length:var(--text-body)]">
                      <span className="font-medium">{describeExpenseCategory(category).label}</span>
                      <span>
                        {formatMad(spent)}
                        {" / "}
                        {formatMad(allocation)}
                      </span>
                    </li>
                  );
                })}
            </ul>
          ) : null}
          <p className="mt-3 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Plan consumption compares spending with the period allocation; an allocation
            takes precedence over an advisory cap while both stay visible. Recording an
            expense never rewrites either value. Published handoff mapping covers{" "}
            {MONEY_HANDOFF_CATEGORY_MAPPING.length} source labels. Coffee consumption uses counted-visit amounts
            while category coffee stays a separate projection.
          </p>
        </>
      ) : (
        <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          Create a tracking period first; a budget plan always belongs to one period.
        </p>
      )}
    </section>

    <section aria-labelledby="money-coffee-heading" className="mt-6 rounded-lg border border-ega-border p-5">
      <h2 id="money-coffee-heading" className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]">
        Counted coffee this week
      </h2>
      {coffeeWindow ? (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Counted visits</dt>
              <dd className="font-medium">
                {coffeeWindow.countedVisitCount}
                {coffeeWindow.visitLimit !== null ? ` / ${coffeeWindow.visitLimit}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Counted visit spend</dt>
              <dd className="font-medium">{formatMad(coffeeWindow.countedVisitSpendMinor)}</dd>
            </div>
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Remaining visits</dt>
              <dd className="font-medium">
                {coffeeWindow.remainingVisits === null ? "No limit" : coffeeWindow.remainingVisits}
              </dd>
            </div>
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Remaining spend</dt>
              <dd className="font-medium">
                {coffeeWindow.remainingSpendMinor === null ? "No limit" : formatMad(coffeeWindow.remainingSpendMinor)}
              </dd>
            </div>
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Spend overshoot</dt>
              <dd className="font-medium">
                {coffeeWindow.spendOvershootMinor === null ? "No limit" : formatMad(coffeeWindow.spendOvershootMinor)}
              </dd>
            </div>
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Visit overshoot</dt>
              <dd className="font-medium">
                {coffeeWindow.visitOvershoot === null ? "No limit" : coffeeWindow.visitOvershoot}
              </dd>
            </div>
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Category coffee (separate)</dt>
              <dd className="font-medium">{formatMad(coffeeWindow.categoryCoffeeSpendMinor)}</dd>
            </div>
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Uncounted category coffee</dt>
              <dd className="font-medium">{formatMad(coffeeWindow.uncountedCategoryCoffeeSpendMinor)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Week {coffeeWindow.weekStart} to {coffeeWindow.weekEnd}
            {coffeeWindow.clippedToPeriod ? " (clipped to the selected period)" : ""}.{" "}
            {coffeeWindow.projectionNote}
            {coffeeWindow.truncated ? " This week hit the bounded scan cap; counts are a lower bound." : ""}
          </p>
        </>
      ) : (
        <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          Counted coffee usage is unavailable right now. Recorded expenses are unaffected.
        </p>
      )}
    </section>

    <section aria-labelledby="money-caps-heading" className="mt-6 rounded-lg border border-ega-border p-5">
      <h2 id="money-caps-heading" className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]">
        {MONEY_ADVISORY_CAP_LABEL}
      </h2>
      {cappedCategories.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1.5">
          {cappedCategories.map(([category, cap]) => {
            // An unavailable or truncated summary must never render as a
            // complete zero-progress bar. A category missing from a truncated
            // read is unknown, not zero; only a complete reading may show 0.
            const spendValue = spentByCategory[category];
            const truncated = summary?.monthToDate.truncated ?? false;
            const hasReading =
              summary !== null && (!truncated || typeof spendValue === "number");
            const spent = spendValue ?? 0;
            const over = hasReading && spent > cap;
            return (
              <li key={category} className="flex flex-wrap items-baseline gap-x-3 text-[length:var(--text-body)]">
                <span className="font-medium">{describeExpenseCategory(category).label}</span>
                {hasReading ? (
                  <span>
                    {new Intl.NumberFormat("fr-MA", { style: "currency", currency: "MAD", minimumFractionDigits: 2 }).format(spent / 100)}
                    {truncated ? "+" : ""}
                    {" / "}
                    {new Intl.NumberFormat("fr-MA", { style: "currency", currency: "MAD", minimumFractionDigits: 2 }).format(cap / 100)}
                  </span>
                ) : (
                  <span className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                    {summary === null
                      ? "Progress unavailable — not shown as zero."
                      : "Incomplete reading — not shown as zero."}
                  </span>
                )}
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

    <section aria-labelledby="money-export-heading" className="mt-6 rounded-lg border border-ega-border p-5">
      <h2 id="money-export-heading" className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]">
        Export expenses
      </h2>
      <form action="/money/export" method="get" className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[length:var(--text-meta)]">
          From
          <input
            type="date"
            name="from"
            required
            defaultValue={`${localToday.slice(0, 7)}-01`}
            className="rounded border border-ega-border bg-transparent px-2 py-1 text-[length:var(--text-body)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-[length:var(--text-meta)]">
          To
          <input
            type="date"
            name="to"
            required
            defaultValue={localToday}
            className="rounded border border-ega-border bg-transparent px-2 py-1 text-[length:var(--text-body)]"
          />
        </label>
        <button type="submit" className="btn-instrument flex h-8 items-center px-3 text-sm">
          Download CSV
        </button>
      </form>
      <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
        Owner-local dates, up to 93 days. The download is complete for the range or the
        request is refused; it is never silently cut off at 10,000 rows.
      </p>
    </section>

    <RefreshOnFocus />
    <MoneyCreatePanel ownerKey={user.id} />
    <MoneyMovementPanel ownerKey={user.id} defaultBookingDate={localToday} />
    {(!result || !result.ok) ? <section role="alert" className="mt-6 rounded-lg border border-ega-border p-5">
      <p>Expenses could not be loaded.</p><a className="underline" href={`/money?offset=${offset}`}>Retry</a>
    </section> : result.data.expenses.length === 0 ? <section className="mt-6 rounded-lg border border-ega-border p-5"><p className="text-ega-text-secondary">{offset === 0 ? "No expenses yet." : "No expenses on this page."}</p>{offset > 0 && <a className="underline" href={`/money?offset=${Math.max(0, offset - 25)}`}>Previous page</a>}</section> : <>
      <div className="mt-6 overflow-x-auto rounded-lg border border-ega-border">
        <table className="w-full min-w-[50rem] text-left text-sm"><caption className="sr-only">Expenses</caption><thead><tr><th scope="col" className="p-3">Date</th><th scope="col" className="p-3">Merchant</th><th scope="col" className="p-3">Category</th><th scope="col" className="p-3">Need or want</th><th scope="col" className="p-3 text-right">Amount</th><th scope="col" className="p-3 text-right">Actions</th></tr></thead>
          <tbody>{result.data.expenses.map((expense) => <tr key={expense.id} className="border-t border-ega-border"><td className="p-3">{expense.occurredAt ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: timezone }).format(new Date(expense.occurredAt)) : `${expense.bookingDate} (time unknown)`}</td><td className="p-3">{expense.merchant ?? "Expense"}{expense.note && <p className="mt-1 text-xs text-ega-text-secondary">{expense.note}</p>}</td><td className="p-3">{expense.category.replaceAll("_", " ")}</td><td className="p-3">{expense.needVsWant}</td><td className="p-3 text-right tabular-nums">{new Intl.NumberFormat("fr-MA", { style: "currency", currency: "MAD", minimumFractionDigits: 2 }).format(expense.amountMinor / 100)}</td><td className="p-3"><MoneyRowActions ownerKey={user.id} expense={expense} /></td></tr>)}</tbody>
        </table>
      </div>
      <nav aria-label="Expense pages" className="mt-4 flex justify-between"><span>{offset > 0 && <a className="underline" href={`/money?offset=${Math.max(0, offset - 25)}`}>Previous</a>}</span><span>{result.data.pagination.hasMore && <a className="underline" href={`/money?offset=${offset + 25}`}>Next</a>}</span></nav>
    </>}

    <section aria-labelledby="money-ledger-heading" className="mt-6 rounded-lg border border-ega-border p-5">
      <h2 id="money-ledger-heading" className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]">
        Movement ledger
      </h2>
      {movementTotals ? (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Expense spending</dt>
              <dd className="text-[length:var(--text-body)] font-medium">{formatMad(movementTotals.expenseTotalMinor)}</dd>
            </div>
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Daily included spending</dt>
              <dd className="text-[length:var(--text-body)] font-medium">{formatMad(movementTotals.dailyIncludedSpendMinor)}</dd>
            </div>
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Funded savings</dt>
              <dd className="text-[length:var(--text-body)] font-medium">{formatMad(movementTotals.savingsFundedMinor)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            {movementTotals.truncated
              ? "Movement totals are a lower bound (over 10,000 movements in the window)."
              : `${movementTotals.counts.movements} movement(s) in the ledger window.`}
          </p>
          <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Tracked cash boundary: {MONEY_TRACKED_CASH_BOUNDARY.spendableCash}. A savings
            transfer {MONEY_TRACKED_CASH_BOUNDARY.savingsTransfer}; an internal transfer has{" "}
            {MONEY_TRACKED_CASH_BOUNDARY.internalTransfer}.
          </p>
        </>
      ) : (
        <p className="mt-3 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          Movement totals are unavailable right now. Your ledger below is unaffected.
        </p>
      )}
      {movements === null ? (
        <p className="mt-3 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          Movements are unavailable right now.
        </p>
      ) : movements.length === 0 ? (
        <p className="mt-3 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          No movements recorded yet. Opening cash appears here once a period is initialized.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <caption className="sr-only">Money movements</caption>
            <thead>
              <tr>
                <th scope="col" className="p-3">Booking date</th>
                <th scope="col" className="p-3">Kind</th>
                <th scope="col" className="p-3">Detail</th>
                <th scope="col" className="p-3">Daily spending</th>
                <th scope="col" className="p-3 text-right">Cash effect</th>
                <th scope="col" className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((movement) => {
                const effect = movementEffect(movement);
                return (
                  <tr key={movement.id} className="border-t border-ega-border">
                    <td className="p-3">{movement.bookingDate}{movement.occurredAt ? "" : " (time unknown)"}</td>
                    <td className="p-3">{movementKindLabel(movement.kind)}</td>
                    <td className="p-3">
                      {movement.merchant ?? "—"}
                      {movement.note ? <p className="mt-1 text-xs text-ega-text-secondary">{movement.note}</p> : null}
                      {movement.category ? <p className="mt-1 text-xs text-ega-text-secondary">{movement.category.replaceAll("_", " ")}</p> : null}
                    </td>
                    <td className="p-3">{movement.countsInDaily ? "Included" : "Excluded"}</td>
                    <td className={`p-3 text-right tabular-nums ${effect.cashDeltaMinor < 0 ? "text-[color:var(--ega-danger)]" : ""}`}>
                      {formatMad(effect.cashDeltaMinor)}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex flex-col items-end gap-2">
                        <MoneyMovementActions movement={movement} />
                        {movement.kind === "expense" && movement.category === "coffee" ? (
                          <CoffeeVisitControls
                            expenseId={movement.id}
                            version={movement.version}
                            recordVisit={recordCoffeeVisitAction}
                            classifyAsGroceries={classifyExpenseCategoryAction}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {movements !== null ? (
        <nav aria-label="Movement pages" className="mt-4 flex justify-between">
          <span>{offset > 0 && <a className="underline" href={`/money?offset=${Math.max(0, offset - 25)}`}>Previous</a>}</span>
          <span>{movementsHasMore && <a className="underline" href={`/money?offset=${offset + 25}`}>Next</a>}</span>
        </nav>
      ) : null}
    </section>
  </main>;
}
