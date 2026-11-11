import { redirect } from "next/navigation";
import {
  createAuthenticatedActor,
  getMoneyState,
  listExpenses,
  type MoneyState,
} from "@ega/application";
import {
  SupabaseExpenseRepository,
  SupabaseMoneyPeriodRepository,
} from "@ega/data-access";
import { MONEY_DEFAULT_TIMEZONE } from "@ega/domain/money";
import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import { RefreshOnFocus } from "@/components/refresh-on-focus";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import { MoneyCreatePanel } from "./_components/money-create-panel";
import { MoneyRowActions } from "./_components/money-row-actions";
import { MoneyPeriodPanel } from "./_components/money-period-panel";
import { CategoryCapsForm } from "./_components/category-caps-form";
import {
  createMoneyPeriodAction,
  saveCategoryCapsAction,
  updateMoneySettingsAction,
} from "./actions";
import { getWebUserPreferencesState } from "@/lib/services/user-preferences-service";
import { getLocalDateInTimezone } from "@ega/domain";
import { getExpenseSummary } from "@ega/application";
import type { ExpenseCategory } from "@ega/domain/expenses";

export const dynamic = "force-dynamic";
export const metadata = { title: "Money", description: "Your personal expense ledger." };

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
  let result;
  let moneyState: MoneyState | null = null;
  let timezone: string = MONEY_DEFAULT_TIMEZONE;
  let timeContextFailed = false;
  try {
    const time = await getWebTimeContext();
    timezone = time.persistedTimezone ?? MONEY_DEFAULT_TIMEZONE;
    const actor = createAuthenticatedActor(user.id);
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
  } catch {
    result = null;
    moneyState = null;
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

    <section aria-labelledby="money-caps-heading" className="mt-6 rounded-lg border border-ega-border p-5">
      <h2 id="money-caps-heading" className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]">
        Monthly category caps
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
                <span className="font-medium">{category.replaceAll("_", " ")}</span>
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
    {(!result || !result.ok) ? <section role="alert" className="mt-6 rounded-lg border border-ega-border p-5">
      <p>Expenses could not be loaded.</p><a className="underline" href={`/money?offset=${offset}`}>Retry</a>
    </section> : result.data.expenses.length === 0 ? <section className="mt-6 rounded-lg border border-ega-border p-5"><p className="text-ega-text-secondary">{offset === 0 ? "No expenses yet." : "No expenses on this page."}</p>{offset > 0 && <a className="underline" href={`/money?offset=${Math.max(0, offset - 25)}`}>Previous page</a>}</section> : <>
      <div className="mt-6 overflow-x-auto rounded-lg border border-ega-border">
        <table className="w-full min-w-[50rem] text-left text-sm"><caption className="sr-only">Expenses</caption><thead><tr><th scope="col" className="p-3">Date</th><th scope="col" className="p-3">Merchant</th><th scope="col" className="p-3">Category</th><th scope="col" className="p-3">Need or want</th><th scope="col" className="p-3 text-right">Amount</th><th scope="col" className="p-3 text-right">Actions</th></tr></thead>
          <tbody>{result.data.expenses.map((expense) => <tr key={expense.id} className="border-t border-ega-border"><td className="p-3">{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: timezone }).format(new Date(expense.occurredAt))}</td><td className="p-3">{expense.merchant ?? "Expense"}{expense.note && <p className="mt-1 text-xs text-ega-text-secondary">{expense.note}</p>}</td><td className="p-3">{expense.category.replaceAll("_", " ")}</td><td className="p-3">{expense.needVsWant}</td><td className="p-3 text-right tabular-nums">{new Intl.NumberFormat("fr-MA", { style: "currency", currency: "MAD", minimumFractionDigits: 2 }).format(expense.amountMinor / 100)}</td><td className="p-3"><MoneyRowActions ownerKey={user.id} expense={expense} /></td></tr>)}</tbody>
        </table>
      </div>
      <nav aria-label="Expense pages" className="mt-4 flex justify-between"><span>{offset > 0 && <a className="underline" href={`/money?offset=${Math.max(0, offset - 25)}`}>Previous</a>}</span><span>{result.data.pagination.hasMore && <a className="underline" href={`/money?offset=${offset + 25}`}>Next</a>}</span></nav>
    </>}
  </main>;
}
