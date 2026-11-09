import { redirect } from "next/navigation";
import { createAuthenticatedActor, listExpenses } from "@ega/application";
import { SupabaseExpenseRepository } from "@ega/data-access";
import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import { MoneyCreatePanel } from "./_components/money-create-panel";
import { MoneyRowActions } from "./_components/money-row-actions";
import { CategoryCapsForm } from "./_components/category-caps-form";
import { saveCategoryCapsAction } from "./actions";
import { getWebUserPreferencesState } from "@/lib/services/user-preferences-service";
import { getLocalDateInTimezone } from "@ega/domain";

export const dynamic = "force-dynamic";
export const metadata = { title: "Money", description: "Your personal expense ledger." };

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
  let capsNote: string | null = null;
  let spentByCategory: Record<string, number> = {};
  try {
    const localToday = getLocalDateInTimezone(new Date(), timezone);
    const monthListed = await listExpenses(
      createAuthenticatedActor(user.id),
      new SupabaseExpenseRepository(client),
      { from: `${localToday.slice(0, 7)}-01`, to: localToday, limit: "100" },
      { timezone },
    );
    if (monthListed.ok) {
      if (monthListed.data.pagination.hasMore) {
        capsNote = "Cap progress is partial (over 100 expenses this month).";
      }
      for (const expense of monthListed.data.expenses) {
        spentByCategory[expense.category] = (spentByCategory[expense.category] ?? 0) + expense.amountMinor;
      }
    } else {
      capsNote = "Cap progress unavailable right now.";
    }
  } catch {
    capsNote = "Cap progress unavailable right now.";
  }
  const cappedCategories = Object.entries(caps).filter(
    ([, cap]) => typeof cap === "number",
  ) as Array<[string, number]>;
  return <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
    <WorkspacePageHeader title="Money" description="Your personal expense ledger." />

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
