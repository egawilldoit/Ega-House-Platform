import { redirect } from "next/navigation";
import {
  createAuthenticatedActor,
  getCurrentMoneyReserves,
  getExpenseSummary,
  getMoneyBudgetPlan,
  getMoneyCoffeeVisitUsage,
  getMoneyMovementTotals,
  getMoneyPeriodSpending,
  getMoneyRolloverPreviewForPeriod,
  getMoneyState,
  listMoneyRolloverBridges,
  listMovements,
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
import { getLocalDateInTimezone } from "@ega/domain";
import {
  MONEY_DEFAULT_TIMEZONE,
  MONEY_TRACKED_CASH_BOUNDARY,
} from "@ega/domain/money";
import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import { RefreshOnFocus } from "@/components/refresh-on-focus";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import { getWebUserPreferencesState } from "@/lib/services/user-preferences-service";
import { MoneyQuickEntry } from "./_components/money-quick-entry";
import { MoneyPrimarySummary } from "./_components/money-primary-summary";
import { MoneyHistory } from "./_components/money-history";
import { MoneyPeriodPanel } from "./_components/money-period-panel";
import { MoneyRolloverPanel } from "./_components/money-rollover-panel";
import { MoneyRolloverVariancePanel } from "./_components/money-rollover-variance-panel";
import { MoneyDayClosePanel } from "./_components/money-day-close-panel";
import { MoneyBudgetPlanPanel } from "./_components/money-budget-plan-panel";
import {
  MoneyCapsPanel,
  MoneyExportPanel,
  MoneyRecordedSpendingPanel,
  MoneyReservesPanel,
} from "./_components/money-overview-panels";
import {
  closeMoneyDayAction,
  createMoneyPeriodAction,
  rebaseMoneyDayStartBaselineAction,
  rolloverMoneyPeriodAction,
  saveBudgetPlanAction,
  saveCategoryCapsAction,
  updateMoneySettingsAction,
} from "./actions";
import {
  MONEY_HISTORY_KIND_OPTIONS,
  MONEY_PAGE_SIZE,
  resolveMoneyHistoryState,
} from "./pagination";

export const dynamic = "force-dynamic";
export const metadata = { title: "Money", description: "Your personal expense ledger." };

type Props = {
  searchParams: Promise<{
    offset?: string;
    kind?: string;
    periodId?: string;
    scope?: string;
  }>;
};

export default async function MoneyPage({ searchParams }: Props) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/money");
  const params = await searchParams;
  const { offset, kind, scope } = resolveMoneyHistoryState(params);
  const selectedPeriodId =
    typeof params.periodId === "string" && params.periodId.trim()
      ? params.periodId.trim()
      : null;
  const client = await createClient();
  const actor = createAuthenticatedActor(user.id);
  let moneyState: MoneyState | null = null;
  let budgetResult: Awaited<ReturnType<typeof getMoneyBudgetPlan>> | null = null;
  let periodSpending: MoneyPeriodSpending | null = null;
  let coffeeUsageResult: Awaited<ReturnType<typeof getMoneyCoffeeVisitUsage>> | null = null;
  let movements: MoneyLedgerRow[] | null = null;
  let movementTotals: MoneyMovementTotals | null = null;
  let totalsUnavailable = false;
  let movementsHasMore = false;
  let reserveResult: Awaited<ReturnType<typeof getCurrentMoneyReserves>> | null = null;
  let rolloverPreview: MoneyRolloverPreview | null = null;
  let rolloverPreviewError: string | null = null;
  let rolloverBridges: readonly MoneyRolloverBridgeRecord[] | null = null;
  let rolloverBridgesTruncated = false;
  let rolloverBridgesError: string | null = null;
  let timezone: string = MONEY_DEFAULT_TIMEZONE;
  let timeContextFailed = false;
  try {
    const time = await getWebTimeContext();
    timezone = time.persistedTimezone ?? MONEY_DEFAULT_TIMEZONE;
    // The period state is the shared owner context. A failed read renders as
    // unavailable rather than as an empty/invented period.
    const stateResult = await getMoneyState(
      actor,
      new SupabaseMoneyPeriodRepository(client),
      { periodId: selectedPeriodId ?? undefined },
      { now: new Date(), timezone: time.persistedTimezone },
    );
    moneyState = stateResult.ok ? stateResult.data : null;

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
      const coffeeUsage = await getMoneyCoffeeVisitUsage(
        actor,
        new SupabaseMoneyCoffeeRepository(client),
        { from: period.startDate, to: period.endDate },
      ).catch(() => null);
      coffeeUsageResult = coffeeUsage;
    }

    // One canonical movement read powers the single history. The optional kind
    // filter is applied before pagination, so page size and hasMore describe the
    // rows actually rendered and no kind is duplicated across two tables.
    const moneyRepository = new SupabaseMoneyRepository(client);
    const movementsResult = await listMovements(
      actor,
      moneyRepository,
      {
        limit: String(MONEY_PAGE_SIZE),
        offset: String(offset),
        ...(scope === "period" && moneyState?.period
          ? {
              from: moneyState.period.startDate,
              to: moneyState.period.endDate,
            }
          : {}),
        ...(kind ? { kind } : {}),
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
    totalsUnavailable = !totalsResult?.ok;
    if (moneyState?.period) {
      reserveResult = await getCurrentMoneyReserves(actor, {
        period: moneyState.period,
        periods: new SupabaseMoneyPeriodRepository(client),
        budgets: new SupabaseMoneyBudgetRepository(client),
        cutoffDate: moneyState.dateResolution.projectionCutoffDate,
        localToday: moneyState.localToday,
      }).catch(() => null);

      // MONEY-001 ID-09: an explicit review may finalize a tracking period with
      // reviewed unclosed days, or an ended period. The preview is read-only and
      // never closes a day or writes a successor.
      if (
        moneyState.period.lifecycle === "ended" ||
        moneyState.period.lifecycle === "superseded" ||
        moneyState.period.lifecycle === "tracking"
      ) {
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

      // Variance disclosure follows the period, not only the rollover preview.
      const bridgesResult = await listMoneyRolloverBridges(
        actor,
        new SupabaseMoneyRolloverRepository(client),
        moneyState.period.id,
      ).catch(() => null);
      rolloverBridges = bridgesResult?.ok ? bridgesResult.data.bridges : null;
      rolloverBridgesTruncated = bridgesResult?.ok
        ? bridgesResult.data.truncated
        : false;
      rolloverBridgesError =
        bridgesResult && !bridgesResult.ok
          ? "Historical correction variances could not be loaded right now."
          : null;
    }
  } catch {
    moneyState = null;
    budgetResult = null;
    periodSpending = null;
    coffeeUsageResult = null;
    movements = null;
    movementTotals = null;
    totalsUnavailable = true;
    reserveResult = null;
    timeContextFailed = true;
  }

  // Monthly caps are advisory progress targets in owner preferences.
  const prefsState = await getWebUserPreferencesState().catch(() => null);
  const caps = prefsState?.preferences.categoryCaps ?? {};
  // A time-context outage makes the summary cutoff ambiguous; report the
  // summary as unavailable rather than presenting a default-timezone total.
  const localToday = getLocalDateInTimezone(new Date(), timezone);
  const summaryResult = timeContextFailed
    ? null
    : await getExpenseSummary(
        createAuthenticatedActor(user.id),
        new SupabaseExpenseRepository(client),
        { localDate: localToday, timezone },
      ).catch(() => null);
  const summary = summaryResult?.ok ? summaryResult.data : null;
  const lifecycle = moneyState?.period?.lifecycle ?? null;
  const trackingPeriod =
    moneyState?.history.find((entry) => entry.lifecycle === "tracking") ??
    (moneyState?.period?.lifecycle === "tracking" ? moneyState.period : null);
  const totalsCutoff =
    moneyState?.cash.cutoffDate ?? moneyState?.dateResolution.resolvedDate ?? localToday;
  const selectedPeriodLabel = moneyState?.period
    ? `Totals for ${moneyState.period.startDate}–${moneyState.period.endDate} through ${totalsCutoff}`
    : `Totals for all recorded history through ${totalsCutoff}`;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <WorkspacePageHeader title="Money" description="Your personal expense ledger." />

      <nav aria-label="Money sections" className="mt-4 flex flex-wrap gap-4 text-[length:var(--text-body)]">
        <a className="underline" aria-current="page" href="/money">Money</a>
        <a className="underline" href="/money/recurring">Bills &amp; recurring</a>
      </nav>

      {moneyState ? (
        <MoneyPrimarySummary moneyState={moneyState} reserve={reserveResult} />
      ) : (
        <section role="alert" className="mt-5 rounded-lg border border-ega-border p-5">
          <h2 className="text-[length:var(--text-section)] font-semibold">
            Money state unavailable
          </h2>
          <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Recorded cash, safe-to-spend and the daily reference cannot be verified right now.
            The movement history below is independent and remains available when it loads.
          </p>
          <a className="mt-2 inline-block underline" href="/money">Retry</a>
        </section>
      )}

      <MoneyQuickEntry ownerKey={user.id} defaultBookingDate={localToday} />

      <MoneyHistory
        ownerKey={user.id}
        movements={movements}
        totals={movementTotals}
        totalsUnavailable={totalsUnavailable}
        hasMore={movementsHasMore}
        offset={offset}
        kind={kind}
        kindOptions={MONEY_HISTORY_KIND_OPTIONS}
        periodId={selectedPeriodId ?? moneyState?.period?.id ?? null}
        timezone={timezone}
        selectedPeriodLabel={selectedPeriodLabel}
        historyScopeLabel={
          scope === "period" && moneyState?.period
            ? `History is scoped to ${moneyState.period.startDate}–${moneyState.period.endDate}.`
            : moneyState?.period
              ? `History covers all recorded movements; totals remain scoped to ${moneyState.period.startDate}–${moneyState.period.endDate}.`
              : "History covers all recorded movements."
        }
        scope={scope}
        trackingPeriod={
          trackingPeriod
            ? {
                id: trackingPeriod.id,
                startDate: trackingPeriod.startDate,
                endDate: trackingPeriod.endDate,
              }
            : null
        }
      />

      <section aria-labelledby="money-secondary-heading" className="mt-6 rounded-lg border border-ega-border p-5">
        <h2 id="money-secondary-heading" className="text-[length:var(--text-section)] font-semibold">
          Plans, records and period tools
        </h2>
        <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          Everyday entry stays above. These secondary tools keep every existing capability
          reachable without competing with the primary view.
        </p>
        <nav aria-label="Money advanced tools" className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[length:var(--text-body)]">
          <a className="underline" href="#money-savings">Savings &amp; emergency</a>
          <a className="underline" href="/money/recurring">Bills &amp; recurring</a>
          <a className="underline" href="#money-budget">Budget &amp; caps</a>
          <a className="underline" href="#money-export">Export</a>
          <a className="underline" href="#money-period">Period setup</a>
          <a className="underline" href="#money-close">Day close</a>
          <a className="underline" href="#money-rollover">Finalize &amp; audit</a>
        </nav>
      </section>

      <section id="money-savings" aria-labelledby="money-savings-heading" className="mt-6">
        <h2 id="money-savings-heading" className="text-[length:var(--text-section)] font-semibold">
          Savings and emergency protection
        </h2>
        <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          Funded savings are money already moved outside spendable cash. The savings target is a
          plan and the emergency reserve is protected capacity, not a payment.
        </p>
        <MoneyReservesPanel reserve={reserveResult} />
      </section>

      <section id="money-budget" className="mt-6" aria-labelledby="money-budget-heading">
        <h2 id="money-budget-heading" className="text-[length:var(--text-section)] font-semibold">
          Budget and advisory caps
        </h2>
        <MoneyBudgetPlanPanel
          period={moneyState?.period ?? null}
          budget={budgetResult}
          spending={periodSpending}
          coffeeUsage={coffeeUsageResult}
          action={saveBudgetPlanAction}
        />
        <MoneyCapsPanel summary={summary} caps={caps} action={saveCategoryCapsAction} />
        <details className="mt-6 rounded border border-ega-border p-3">
          <summary className="cursor-pointer text-[length:var(--text-body)] font-semibold">
            Spending summaries
          </summary>
          <MoneyRecordedSpendingPanel summary={summary} />
        </details>
      </section>

      <section id="money-export" aria-labelledby="money-export-area-heading" className="mt-6">
        <h2 id="money-export-area-heading" className="text-[length:var(--text-section)] font-semibold">
          Export
        </h2>
        <MoneyExportPanel localToday={localToday} />
      </section>

      <section id="money-period" aria-labelledby="money-period-area-heading" className="mt-6">
        <h2 id="money-period-area-heading" className="text-[length:var(--text-section)] font-semibold">
          Period setup and settings
        </h2>
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
            rebaseAction={rebaseMoneyDayStartBaselineAction}
            initialSetupIncomplete={moneyState.dayStartBaseline?.unavailableReason === "initial_setup_incomplete"}
          />
        ) : (
          <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Period setup is unavailable while the Money state cannot be loaded.
          </p>
        )}
      </section>

      {moneyState?.period ? (
        <section id="money-close" aria-labelledby="money-close-area-heading" className="mt-6">
          <h2 id="money-close-area-heading" className="text-[length:var(--text-section)] font-semibold">
            Optional day close
          </h2>
          <MoneyDayClosePanel
            key={`close:${moneyState.period.id}:${moneyState.period.version}`}
            period={moneyState.period}
            dayClose={moneyState.dayClose}
            lastClose={moneyState.lastClose}
            recentCloses={moneyState.recentCloses}
            dayClosesUnavailable={moneyState.dayClosesUnavailable}
            unverifiedDates={moneyState.unverifiedDates}
            unverifiedDayCount={moneyState.unverifiedDayCount}
            action={closeMoneyDayAction}
          />
        </section>
      ) : null}

      {moneyState?.period ? (
        <section id="money-rollover" aria-labelledby="money-rollover-area-heading" className="mt-6">
          <h2 id="money-rollover-area-heading" className="text-[length:var(--text-section)] font-semibold">
            Finalize, roll over and audit
          </h2>
          <MoneyRolloverVariancePanel
            bridges={rolloverBridges}
            truncated={rolloverBridgesTruncated}
            unavailableReason={rolloverBridgesError}
          />
          {(lifecycle === "tracking" ||
            lifecycle === "superseded" ||
            lifecycle === "ended") ? (
            <MoneyRolloverPanel
              preview={rolloverPreview}
              previewUnavailableReason={rolloverPreviewError}
              action={rolloverMoneyPeriodAction}
            />
          ) : (
            <p className="mt-3 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
              This period is {lifecycle?.replaceAll("_", " ")}. Continue from its successor;
              historical corrections remain visible above.
            </p>
          )}
        </section>
      ) : null}

      <p className="mt-6 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
        Tracked cash boundary: {MONEY_TRACKED_CASH_BOUNDARY.spendableCash}. A savings
        transfer {MONEY_TRACKED_CASH_BOUNDARY.savingsTransfer}; an internal transfer has{" "}
        {MONEY_TRACKED_CASH_BOUNDARY.internalTransfer}.
      </p>

      <RefreshOnFocus />
    </main>
  );
}
