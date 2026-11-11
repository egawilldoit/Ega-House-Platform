import { redirect } from "next/navigation";
import { createAuthenticatedActor, getMoneyState, listExpenses, listMovements } from "@ega/application";
import { SupabaseExpenseRepository, SupabaseMoneyRepository } from "@ega/data-access";
import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import { MoneyCreatePanel } from "./_components/money-create-panel";
import { MoneyMovementPanel } from "./_components/money-movement-panel";
import { MoneyMovementActions } from "./_components/money-movement-actions";
import { MoneyRowActions } from "./_components/money-row-actions";
import { CategoryCapsForm } from "./_components/category-caps-form";
import { saveCategoryCapsAction } from "./actions";
import { getWebUserPreferencesState } from "@/lib/services/user-preferences-service";
import { getLocalDateInTimezone } from "@ega/domain";
import { getExpenseSummary } from "@ega/application";
import type { ExpenseCategory } from "@ega/domain/expenses";

export const dynamic = "force-dynamic";
export const metadata = { title: "Money", description: "Your personal expense ledger." };

function formatMad(minor: number): string {
  return new Intl.NumberFormat("fr-MA", { style: "currency", currency: "MAD", minimumFractionDigits: 2 }).format(minor / 100);
}

function movementKindLabel(kind: string): string {
  return kind.replaceAll("_", " ");
}

type Props = { searchParams: Promise<{ offset?: string }> };

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
  // MONEY-04: recorded cash and the canonical movement ledger. Failures render
  // as unavailable, never as a confirmed zero balance.
  const moneyRepository = new SupabaseMoneyRepository(client);
  const stateResult = await getMoneyState(
    createAuthenticatedActor(user.id),
    moneyRepository,
    {},
    { timezone },
  ).catch(() => null);
  const moneyState = stateResult?.ok ? stateResult.data.state : null;
  const movementsResult = await listMovements(
    createAuthenticatedActor(user.id),
    moneyRepository,
    { limit: "25", offset: String(offset) },
    { timezone },
  ).catch(() => null);
  const movements = movementsResult?.ok ? movementsResult.data.movements : null;
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

    <section aria-labelledby="money-cash-heading" className="mt-6 rounded-lg border border-ega-border p-5">
      <h2 id="money-cash-heading" className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]">
        Recorded cash
      </h2>
      {moneyState ? (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Recorded cash at cutoff</dt>
              <dd className="text-[length:var(--text-body)] font-medium">{formatMad(moneyState.recordedCashMinor)}</dd>
            </div>
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Expense spending</dt>
              <dd className="text-[length:var(--text-body)] font-medium">{formatMad(moneyState.expenseTotalMinor)}</dd>
            </div>
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Daily included spending</dt>
              <dd className="text-[length:var(--text-body)] font-medium">{formatMad(moneyState.dailyIncludedSpendMinor)}</dd>
            </div>
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Funded savings</dt>
              <dd className="text-[length:var(--text-body)] font-medium">{formatMad(moneyState.savingsFundedMinor)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Cutoff {moneyState.cutoff} · opening {formatMad(moneyState.openingMinor)} · inflows {formatMad(moneyState.inflowsMinor)} · outflows {formatMad(moneyState.outflowsMinor)} · {moneyState.counts.movements} movement(s).
          </p>
          <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Spendable-cash boundary: {moneyState.boundary.savingsTransfer}. {moneyState.boundary.internalTransfer}.
          </p>
          <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            {moneyState.completeness.confirmed
              ? `Balance status: confirmed by the ${moneyState.period.lifecycle ?? "tracking"} period opening and complete history.`
              : `Balance status: incomplete (${moneyState.completeness.reasons.join(", ")}). Treat recorded cash as the model so far, not a confirmed balance.`}
            {moneyState.period.available && moneyState.period.id ? ` Period ${moneyState.period.startDate} to ${moneyState.period.endDate}.` : moneyState.period.available ? " No period is configured yet." : " Period table is not deployed yet."}
          </p>
          {moneyState.period.provenance ? (
            <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
              Opening provenance: {String((moneyState.period.provenance as Record<string, unknown>).source ?? "recorded")}.
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          Recorded cash is unavailable right now. Your ledger below is unaffected.
        </p>
      )}
    </section>

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
            const spent = spentByCategory[category] ?? 0;
            const over = spent > cap;
            return (
              <li key={category} className="flex flex-wrap items-baseline gap-x-3 text-[length:var(--text-body)]">
                <span className="font-medium">{category.replaceAll("_", " ")}</span>
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
    <MoneyMovementPanel ownerKey={user.id} defaultBookingDate={localToday} />
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

    <section aria-labelledby="money-ledger-heading" className="mt-6 rounded-lg border border-ega-border p-5">
      <h2 id="money-ledger-heading" className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]">
        Movement ledger
      </h2>
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
                const cashEffect = movement.kind === "opening"
                  ? movement.amountMinor
                  : movement.direction === "in" ? movement.amountMinor : -movement.amountMinor;
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
                    <td className={`p-3 text-right tabular-nums ${cashEffect < 0 ? "text-[color:var(--ega-danger)]" : ""}`}>
                      {formatMad(cashEffect)}
                    </td>
                    <td className="p-3 text-right"><MoneyMovementActions movement={movement} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {movementsResult?.ok ? (
        <nav aria-label="Movement pages" className="mt-4 flex justify-between">
          <span>{offset > 0 && <a className="underline" href={`/money?offset=${Math.max(0, offset - 25)}`}>Previous</a>}</span>
          <span>{movementsResult.data.pagination.hasMore && <a className="underline" href={`/money?offset=${offset + 25}`}>Next</a>}</span>
        </nav>
      ) : null}
    </section>
  </main>;
}
