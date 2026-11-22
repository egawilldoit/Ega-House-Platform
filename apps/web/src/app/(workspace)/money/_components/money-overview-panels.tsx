import type {
  ApplicationResult,
  ExpenseSummaryResult,
  MoneyReserveProjection,
  MoneyState,
} from "@ega/application";
import type { ExpenseCategory } from "@ega/domain/expenses";
import {
  MONEY_ADVISORY_CAP_LABEL,
  describeExpenseCategory,
} from "@ega/domain/money";

import { CategoryCapsForm } from "./category-caps-form";
import { formatMad } from "./money-format";

type CapsAction = (formData: FormData) => Promise<{
  ok: boolean;
  error: string | null;
}>;

/** Current reserves and safe funds. Missing inputs stay unavailable, never zero. */
export function MoneyReservesPanel({
  reserve,
}: {
  reserve: ApplicationResult<MoneyReserveProjection> | null;
}) {
  return (
    <section aria-labelledby="reserves-heading" className="mt-6 rounded-lg border border-ega-border p-5">
      <h2 id="reserves-heading" className="text-[length:var(--text-section)] font-semibold">Current reserves and safe funds</h2>
      {reserve?.ok && reserve.data.available ? (
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          {([
            ["Recorded cash", reserve.data.reserves.recordedCashMinor],
            ["Unpaid commitments", reserve.data.reserves.unpaidCommitmentsMinor],
            ["Savings target", reserve.data.reserves.savingsTargetMinor],
            ["Savings funded", reserve.data.reserves.fundedSavingsMinor],
            ["Unfunded savings", reserve.data.reserves.unfundedSavingsMinor],
            ["Emergency target", reserve.data.reserves.emergencyTargetMinor],
            ["Emergency used", reserve.data.reserves.emergencyUsedMinor],
            ["Remaining emergency reserve", reserve.data.reserves.remainingEmergencyMinor],
            ["Safe flexible funds", reserve.data.reserves.safeFlexibleMinor],
          ] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="font-semibold">{formatMad(value)}</dd></div>)}
        </dl>
      ) : <p role="status" className="mt-3 text-[color:var(--ega-text-secondary)]">Unavailable — reserve inputs are incomplete or could not be loaded.</p>}
    </section>
  );
}

/** The shared day-start daily reference, labelled historical for an ended period. */
export function MoneyDailyReferencePanel({ moneyState }: { moneyState: MoneyState }) {
  const reference = moneyState.dayStartBaseline?.dailyReference;
  return (
    <section aria-labelledby="daily-reference-heading" className="mt-6 rounded-lg border border-ega-border p-5">
      <h2 id="daily-reference-heading" className="text-[length:var(--text-section)] font-semibold">Day-start daily reference</h2>
      <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Method: {reference?.available ? reference.algorithm : "shared day-start daily reference"}</p>
      {reference?.available ? (
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          <div><dt>{reference.historical ? "Historical daily reference" : "Daily reference"}</dt><dd className="font-semibold">{formatMad(reference.referenceMinor)}</dd></div>
          <div><dt>{reference.historical ? "Historical daily remaining" : "Daily remaining"}</dt><dd className="font-semibold">{formatMad(reference.dailyRemainingMinor)}</dd></div>
          <div><dt>Daily included spending</dt><dd className="font-semibold">{formatMad(reference.dailyIncludedExpenseMinor)}</dd></div>
          <div><dt>Days left in period</dt><dd className="font-semibold">{reference.daysRemaining}</dd></div>
          {reference.historical ? <p className="text-[color:var(--ega-text-secondary)]">Ended period — historical result only; no new-day spend allowance.</p> : null}
        </dl>
      ) : (
        <p role="status" className="mt-3 text-[color:var(--ega-text-secondary)]">Unavailable — baseline or complete daily expense data is missing.</p>
      )}
    </section>
  );
}

/** Recorded spending projection. A failed read is unavailable, not zero. */
export function MoneyRecordedSpendingPanel({
  summary,
}: {
  summary: ExpenseSummaryResult | null;
}) {
  return (
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
                {formatMad(summary.day.totalMinor)}
                <span className="block text-[length:var(--text-meta)] font-normal text-[color:var(--ega-text-secondary)]">{summary.day.recordCount} recorded{summary.day.truncated ? " (lower bound)" : ""}</span>
              </dd>
            </div>
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">This week</dt>
              <dd className="text-[length:var(--text-body)] font-medium">
                {formatMad(summary.weekToDate.totalMinor)}
                <span className="block text-[length:var(--text-meta)] font-normal text-[color:var(--ega-text-secondary)]">{summary.weekToDate.recordCount} recorded{summary.weekToDate.truncated ? " (lower bound)" : ""}</span>
              </dd>
            </div>
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">This month</dt>
              <dd className="text-[length:var(--text-body)] font-medium">
                {formatMad(summary.monthToDate.totalMinor)}
                <span className="block text-[length:var(--text-meta)] font-normal text-[color:var(--ega-text-secondary)]">{summary.monthToDate.recordCount} recorded{summary.monthToDate.truncated ? " (lower bound)" : ""}</span>
              </dd>
            </div>
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Coffee this month</dt>
              <dd className="text-[length:var(--text-body)] font-medium">
                {formatMad(summary.coffee.totalMinor)}
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
                    <span>{formatMad(minor ?? 0)}</span>
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
  );
}

/**
 * Advisory monthly caps progress. An unavailable or truncated summary never
 * renders as a complete zero-progress bar.
 */
export function MoneyCapsPanel({
  summary,
  caps,
  action,
}: {
  summary: ExpenseSummaryResult | null;
  caps: Partial<Record<ExpenseCategory, number>>;
  action: CapsAction;
}) {
  const spentByCategory = summary?.monthToDate.totalsByCategory ?? {};
  const capsNote = summary
    ? summary.monthToDate.truncated
      ? "Cap progress is a lower bound (over 10,000 expenses this month)."
      : null
    : "Spending summaries unavailable right now.";
  const cappedCategories = Object.entries(caps).filter(
    ([, cap]) => typeof cap === "number",
  ) as Array<[ExpenseCategory, number]>;

  return (
    <section aria-labelledby="money-caps-heading" className="mt-6 rounded-lg border border-ega-border p-5">
      <h2 id="money-caps-heading" className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]">
        {MONEY_ADVISORY_CAP_LABEL}
      </h2>
      {cappedCategories.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1.5">
          {cappedCategories.map(([category, cap]) => {
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
                    {formatMad(spent)}
                    {truncated ? "+" : ""}
                    {" / "}
                    {formatMad(cap)}
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
        <CategoryCapsForm caps={caps} action={action} returnTo="/money" />
      </div>
    </section>
  );
}

/** Complete-or-refused owner-local CSV export range. */
export function MoneyExportPanel({ localToday }: { localToday: string }) {
  return (
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
  );
}
