import { redirect } from "next/navigation";
import { createAuthenticatedActor, listExpenses } from "@ega/application";
import { SupabaseExpenseRepository } from "@ega/data-access";
import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";

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
  return <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
    <WorkspacePageHeader title="Money" description="Your personal expense ledger." />
    {(!result || !result.ok) ? <section role="alert" className="mt-6 rounded-lg border border-ega-border p-5">
      <p>Expenses could not be loaded.</p><a className="underline" href={`/money?offset=${offset}`}>Retry</a>
    </section> : result.data.expenses.length === 0 ? <section className="mt-6 rounded-lg border border-ega-border p-5"><p className="text-ega-text-secondary">{offset === 0 ? "No expenses yet." : "No expenses on this page."}</p>{offset > 0 && <a className="underline" href={`/money?offset=${Math.max(0, offset - 25)}`}>Previous page</a>}</section> : <>
      <div className="mt-6 overflow-x-auto rounded-lg border border-ega-border">
        <table className="w-full min-w-[42rem] text-left text-sm"><caption className="sr-only">Expenses</caption><thead><tr><th scope="col" className="p-3">Date</th><th scope="col" className="p-3">Merchant</th><th scope="col" className="p-3">Category</th><th scope="col" className="p-3">Need or want</th><th scope="col" className="p-3 text-right">Amount</th></tr></thead>
          <tbody>{result.data.expenses.map((expense) => <tr key={expense.id} className="border-t border-ega-border"><td className="p-3">{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: timezone }).format(new Date(expense.occurredAt))}</td><td className="p-3">{expense.merchant ?? "Expense"}{expense.note && <p className="mt-1 text-xs text-ega-text-secondary">{expense.note}</p>}</td><td className="p-3">{expense.category.replaceAll("_", " ")}</td><td className="p-3">{expense.needVsWant}</td><td className="p-3 text-right tabular-nums">{new Intl.NumberFormat("fr-MA", { style: "currency", currency: "MAD", minimumFractionDigits: 2 }).format(expense.amountMinor / 100)}</td></tr>)}</tbody>
        </table>
      </div>
      <nav aria-label="Expense pages" className="mt-4 flex justify-between"><span>{offset > 0 && <a className="underline" href={`/money?offset=${Math.max(0, offset - 25)}`}>Previous</a>}</span><span>{result.data.pagination.hasMore && <a className="underline" href={`/money?offset=${offset + 25}`}>Next</a>}</span></nav>
    </>}
  </main>;
}
