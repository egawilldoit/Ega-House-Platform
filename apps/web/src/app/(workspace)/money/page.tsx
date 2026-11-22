import { redirect } from "next/navigation";
import {
  createAuthenticatedActor,
  getMoneyBudgetPlan,
  getMoneyCoffeeVisitUsage,
  getMoneyMovementTotals,
  getMoneyPeriodSpending,
  getCurrentMoneyReserves,
  getMoneyRolloverPreviewForPeriod,
  getMoneyState,
  listExpenses,
  listMoneyRolloverBridges,
  listMovements,
  movementEffect,
  getExpenseSummary,
  type MoneyMovementTotals,
  type MoneyPeriodSpending,
  type MoneyRolloverBridgeRecord,
  type MoneyRolloverPreview,
  type MoneyState,
} from "@ega/application";
import {
  SupabaseExpenseRepository,
  SupabaseMoneyBudgetRepository,
  SupabaseMoneyCoffeeRepository,
  SupabaseMoneyPeriodRepository,
  SupabaseMoneyRepository,
  SupabaseMoneyRolloverRepository,
  SupabaseObligationRepository,
} from "@ega/data-access";
import type { MoneyLedgerRow } from "@ega/domain/money";
import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import { RefreshOnFocus } from "@/components/refresh-on-focus";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import { MoneyCreatePanel } from "./_components/money-create-panel";
import { MoneyPeriodPanel } from "./_components/money-period-panel";
import { MoneyRolloverPanel } from "./_components/money-rollover-panel";
import { MoneyRolloverVariancePanel } from "./_components/money-rollover-variance-panel";
import { MoneyDayClosePanel } from "./_components/money-day-close-panel";
import { MoneyMovementPanel } from "./_components/money-movement-panel";
import { MoneyMovementActions } from "./_components/money-movement-actions";
import { MoneyRowActions } from "./_components/money-row-actions";
import { MoneyBudgetPlanPanel } from "./_components/money-budget-plan-panel";
import {
  MoneyCapsPanel,
  MoneyDailyReferencePanel,
  MoneyExportPanel,
  MoneyRecordedSpendingPanel,
  MoneyReservesPanel,
} from "./_components/money-overview-panels";
import { formatMad, movementKindLabel } from "./_components/money-format";
import { closeMoneyDayAction, createMoneyPeriodAction, rebaseMoneyDayStartBaselineAction, rolloverMoneyPeriodAction, saveBudgetPlanAction, saveCategoryCapsAction, updateMoneySettingsAction } from "./actions";
import { getWebUserPreferencesState } from "@/lib/services/user-preferences-service";
import { getLocalDateInTimezone } from "@ega/domain";
import {
  MONEY_DEFAULT_TIMEZONE,
  MONEY_TRACKED_CASH_BOUNDARY,
} from "@ega/domain/money";
import {
  MONEY_PAGE_SIZE,
  moneyHref,
  resolveMoneyPagerOffsets,
} from "./pagination";

export const dynamic = "force-dynamic";
export const metadata = { title: "Money", description: "Your personal expense ledger." };

type Props = {
  searchParams: Promise<{
    offset?: string;
    expenseOffset?: string;
    movementOffset?: string;
    periodId?: string;
  }>;
};

export default async function MoneyPage({ searchParams }: Props) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/money");
  const params = await searchParams;
  const { expenseOffset, movementOffset } = resolveMoneyPagerOffsets(params);
  const selectedPeriodId =
    typeof params.periodId === "string" && params.periodId.trim()
      ? params.periodId.trim()
      : null;
  const client = await createClient();
  const actor = createAuthenticatedActor(user.id);
  let result;
  let moneyState: MoneyState | null = null;
  let budgetResult: Awaited<ReturnType<typeof getMoneyBudgetPlan>> | null = null;
  let periodSpending: MoneyPeriodSpending | null = null;
  let coffeeUsageResult: Awaited<ReturnType<typeof getMoneyCoffeeVisitUsage>> | null = null;
  let movements: MoneyLedgerRow[] | null = null;
  let movementTotals: MoneyMovementTotals | null = null;
  let reserveResult: Awaited<ReturnType<typeof getCurrentMoneyReserves>> | null = null;
  let rolloverPreview: MoneyRolloverPreview | null = null;
  let rolloverPreviewError: string | null = null;
  let rolloverBridges: readonly MoneyRolloverBridgeRecord[] | null = null;
  let rolloverBridgesTruncated = false;
  let rolloverBridgesError: string | null = null;
  let movementsHasMore = false;
  let timezone: string = MONEY_DEFAULT_TIMEZONE;
  let timeContextFailed = false;
  try {
    const time = await getWebTimeContext();
    timezone = time.persistedTimezone ?? MONEY_DEFAULT_TIMEZONE;
    result = await listExpenses(actor, new SupabaseExpenseRepository(client), { limit: String(MONEY_PAGE_SIZE), offset: String(expenseOffset) }, { timezone });
    // The period state is the shared owner context. A failed read renders as
    // unavailable rather than as an empty/invented period.
    const stateResult = await getMoneyState(
      actor,
      new SupabaseMoneyPeriodRepository(client),
      { periodId: selectedPeriodId ?? undefined },
      { now: new Date(), timezone: time.persistedTimezone },
    );
    moneyState = stateResult.ok ? stateResult.data : null;

    // MONEY-05 period plan. A plan belongs to the canonical period and fails
    // closed instead of inventing zero values.
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
      // Budget consumption is period-scoped. The month-to-date summary below
      // remains the advisory monthly cap projection and is never reused here.
      const spendingResult = await getMoneyPeriodSpending(
        actor,
        new SupabaseExpenseRepository(client),
        {
          periodStartDate: period.startDate,
          periodEndDate: period.endDate,
          timezone: period.timezone,
        },
      ).catch(() => null);
      periodSpending = spendingResult?.ok ? spendingResult.data : null;
      // Counted-visit coffee consumption is a distinct reading from category
      // coffee totals; load it for the allocation row only.
      const coffeeUsage = await getMoneyCoffeeVisitUsage(
        actor,
        new SupabaseMoneyCoffeeRepository(client),
        { from: period.startDate, to: period.endDate },
      ).catch(() => null);
      coffeeUsageResult = coffeeUsage;
    }

    // MONEY-04 movement ledger: the same canonical rows and totals as HTTP/MCP.
    // Failures render as unavailable, never as a confirmed zero balance.
    const moneyRepository = new SupabaseMoneyRepository(client);
    // Expenses live in the table above. The non-expense exclusion is part of
    // the repository query, so the page window and hasMore describe only the
    // rows this ledger actually renders.
    const movementsResult = await listMovements(
      actor,
      moneyRepository,
      {
        limit: String(MONEY_PAGE_SIZE),
        offset: String(movementOffset),
        excludeKind: "expense",
      },
      { timezone },
    ).catch(() => null);
    movements = movementsResult?.ok ? movementsResult.data.movements : null;
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
    if (moneyState?.period) {
      reserveResult = await getCurrentMoneyReserves(actor, {
        period: moneyState.period,
        periods: new SupabaseMoneyPeriodRepository(client),
        budgets: new SupabaseMoneyBudgetRepository(client),
      }).catch(() => null);

      // MONEY-10: only a finished period can be rolled over. The preview is
      // read-only and never closes a day or writes a successor.
      if (moneyState.period.lifecycle === "ended") {
        const previewResult = await getMoneyRolloverPreviewForPeriod(
          actor,
          {
            repository: new SupabaseMoneyRolloverRepository(client),
            obligations: new SupabaseObligationRepository(client),
          },
          moneyState.period.id,
          { now: new Date(), timezone: time.persistedTimezone },
        ).catch(() => null);
        rolloverPreview = previewResult?.ok ? previewResult.data : null;
        rolloverPreviewError =
          previewResult && !previewResult.ok ? previewResult.errorMessage : null;
      }

      // Variance disclosure follows the period, not only the ended-source
      // preview: a tracking successor can receive a correction variance from a
      // rolled-over predecessor.
      const bridgesResult = await listMoneyRolloverBridges(
        actor,
        new SupabaseMoneyRolloverRepository(client),
        moneyState.period.id,
      ).catch(() => null);
      rolloverBridges = bridgesResult?.ok
        ? bridgesResult.data.bridges
        : null;
      rolloverBridgesTruncated = bridgesResult?.ok
        ? bridgesResult.data.truncated
        : false;
      rolloverBridgesError =
        bridgesResult && !bridgesResult.ok
          ? "Historical correction variances could not be loaded right now."
          : null;
    }
  } catch {
    result = null;
    moneyState = null;
    budgetResult = null;
    periodSpending = null;
    coffeeUsageResult = null;
    movements = null;
    movementTotals = null;
    reserveResult = null;
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
  // The ledgers are global; only the totals projection is narrowed by the
  // selected period. Label both explicitly so a historical selection never
  // looks like it silently rewrote global rows or cash calculations.
  const totalsCutoff =
    moneyState?.cash.cutoffDate ?? moneyState?.dateResolution.resolvedDate ?? localToday;
  const expenseLedgerScope =
    "All recorded expenses across every period, newest first. Selecting a historical period does not change this ledger.";
  const movementLedgerScope =
    "All non-expense movements across every period, newest first. Selecting a historical period does not change this ledger.";
  const totalsScope = moneyState?.period
    ? `Totals cover the selected period from ${moneyState.period.startDate} through ${totalsCutoff}.`
    : `Totals cover all recorded history through ${totalsCutoff}.`;
  const summaryResult = timeContextFailed
    ? null
    : await getExpenseSummary(
        createAuthenticatedActor(user.id),
        new SupabaseExpenseRepository(client),
        { localDate: localToday, timezone },
      ).catch(() => null);
  const summary = summaryResult?.ok ? summaryResult.data : null;
  const lifecycle = moneyState?.period?.lifecycle ?? null;
  return <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
    <WorkspacePageHeader title="Money" description="Your personal expense ledger." />

    <nav aria-label="Money sections" className="mt-4 flex flex-wrap gap-4 text-[length:var(--text-body)]">
      <a className="underline" aria-current="page" href="/money">Money ledger</a>
      <a className="underline" href="/money/recurring">Recurring</a>
    </nav>

    <MoneyReservesPanel reserve={reserveResult} />

    {moneyState ? (
      <>
      <MoneyDailyReferencePanel moneyState={moneyState} />
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
        rebaseAction={rebaseMoneyDayStartBaselineAction}
        initialSetupIncomplete={moneyState.dayStartBaseline?.unavailableReason === "initial_setup_incomplete"}
      />
      {moneyState.period ? (
        <MoneyRolloverVariancePanel
          bridges={rolloverBridges}
          truncated={rolloverBridgesTruncated}
          unavailableReason={rolloverBridgesError}
        />
      ) : null}
      {/* Lifecycle staging: a tracking period permits a day close, an ended
          period requires rollover. Only the applicable panel is mounted. */}
      {(lifecycle === "tracking" || lifecycle === "ended" || lifecycle === "rolled_over") && moneyState.period ? (
        <MoneyDayClosePanel
          key={`close:${moneyState.period.id}:${moneyState.period.version}`}
          period={moneyState.period}
          dayClose={moneyState.dayClose}
          lastClose={moneyState.lastClose}
          recentCloses={moneyState.recentCloses}
          dayClosesUnavailable={moneyState.dayClosesUnavailable}
          action={closeMoneyDayAction}
        />
      ) : null}
      {lifecycle === "ended" && moneyState.period ? (
        <MoneyRolloverPanel
          preview={rolloverPreview}
          previewUnavailableReason={rolloverPreviewError}
          action={rolloverMoneyPeriodAction}
        />
      ) : null}
      </>
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

    <MoneyRecordedSpendingPanel summary={summary} />

    <MoneyBudgetPlanPanel
      period={moneyState?.period ?? null}
      budget={budgetResult}
      spending={periodSpending}
      coffeeUsage={coffeeUsageResult}
      action={saveBudgetPlanAction}
    />

    <MoneyCapsPanel summary={summary} caps={caps} action={saveCategoryCapsAction} />

    <MoneyExportPanel localToday={localToday} />

    <RefreshOnFocus />
    <MoneyCreatePanel ownerKey={user.id} />
    <MoneyMovementPanel ownerKey={user.id} defaultBookingDate={localToday} />
    <section aria-labelledby="money-expenses-heading" className="mt-6">
      <h2 id="money-expenses-heading" className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]">Expenses</h2>
      <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">{expenseLedgerScope}</p>
      {(!result || !result.ok) ? <section role="alert" className="mt-3 rounded-lg border border-ega-border p-5">
        <p>Expenses could not be loaded.</p><a className="underline" href={moneyHref({ periodId: selectedPeriodId, expenseOffset, movementOffset })}>Retry</a>
      </section> : result.data.expenses.length === 0 ? <section className="mt-3 rounded-lg border border-ega-border p-5"><p className="text-ega-text-secondary">{expenseOffset === 0 ? "No expenses yet." : "No expenses on this page."}</p>{expenseOffset > 0 && <a className="underline" href={moneyHref({ periodId: selectedPeriodId, expenseOffset: Math.max(0, expenseOffset - MONEY_PAGE_SIZE), movementOffset })}>Previous page</a>}</section> : <>
      <div className="mt-3 overflow-x-auto rounded-lg border border-ega-border">
        <table className="w-full min-w-[50rem] text-left text-sm"><caption className="sr-only">Expenses</caption><thead><tr><th scope="col" className="p-3">Date</th><th scope="col" className="p-3">Merchant</th><th scope="col" className="p-3">Category</th><th scope="col" className="p-3">Need or want</th><th scope="col" className="p-3 text-right">Amount</th><th scope="col" className="p-3 text-right">Actions</th></tr></thead>
          <tbody>{result.data.expenses.map((expense) => <tr key={expense.id} className="border-t border-ega-border"><td className="p-3">{expense.occurredAt ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: timezone }).format(new Date(expense.occurredAt)) : `${expense.bookingDate} (time unknown)`}</td><td className="p-3">{expense.merchant ?? "Expense"}{expense.note && <p className="mt-1 text-xs text-ega-text-secondary">{expense.note}</p>}</td><td className="p-3">{expense.category.replaceAll("_", " ")}</td><td className="p-3">{expense.needVsWant}</td><td className="p-3 text-right tabular-nums">{new Intl.NumberFormat("fr-MA", { style: "currency", currency: "MAD", minimumFractionDigits: 2 }).format(expense.amountMinor / 100)}</td><td className="p-3"><div className="flex flex-col items-end gap-2"><MoneyRowActions ownerKey={user.id} expense={expense} /></div></td></tr>)}</tbody>
        </table>
      </div>
      <nav aria-label="Expense pages" className="mt-4 flex justify-between"><span>{expenseOffset > 0 && <a className="underline" href={moneyHref({ periodId: selectedPeriodId, expenseOffset: Math.max(0, expenseOffset - MONEY_PAGE_SIZE), movementOffset })}>Previous</a>}</span><span>{result.data.pagination.hasMore && <a className="underline" href={moneyHref({ periodId: selectedPeriodId, expenseOffset: expenseOffset + MONEY_PAGE_SIZE, movementOffset })}>Next</a>}</span></nav>
    </>}
    </section>

    <section aria-labelledby="money-ledger-heading" className="mt-6 rounded-lg border border-ega-border p-5">
      <h2 id="money-ledger-heading" className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]">
        Movement ledger
      </h2>
      <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">{movementLedgerScope}</p>
      {movementTotals ? (
        <>
          <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">{totalsScope}</p>
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
          {movementOffset === 0
            ? "No non-expense movements recorded yet. Opening cash appears here once a period is initialized."
            : "No non-expense movements on this page."}
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
                      <MoneyMovementActions movement={movement} />
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
          <span>{movementOffset > 0 && <a className="underline" href={moneyHref({ periodId: selectedPeriodId, expenseOffset, movementOffset: Math.max(0, movementOffset - MONEY_PAGE_SIZE) })}>Previous</a>}</span>
          <span>{movementsHasMore && <a className="underline" href={moneyHref({ periodId: selectedPeriodId, expenseOffset, movementOffset: movementOffset + MONEY_PAGE_SIZE })}>Next</a>}</span>
        </nav>
      ) : null}
    </section>
  </main>;
}
