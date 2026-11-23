import { movementEffect, type MoneyMovementTotals } from "@ega/application";
import type { ExpenseDto } from "@ega/contracts/expenses";
import type { MoneyLedgerRow, MoneyKind } from "@ega/domain/money";

import { formatMad, movementKindLabel } from "./money-format";
import { moneyHref, MONEY_PAGE_SIZE, type MoneyHistoryKind } from "../pagination";
import { MoneyMovementActions } from "./money-movement-actions";
import { MoneyRowActions } from "./money-row-actions";

type MoneyHistoryProps = {
  ownerKey: string;
  movements: readonly MoneyLedgerRow[] | null;
  totals: MoneyMovementTotals | null;
  totalsUnavailable: boolean;
  hasMore: boolean;
  offset: number;
  kind: MoneyKind | null;
  kindOptions: readonly MoneyHistoryKind[];
  periodId: string | null;
  timezone: string;
  selectedPeriodLabel: string | null;
  historyScopeLabel: string;
  scope: "period" | "all";
  /** The one tracking period; rows from other periods keep their date locked. */
  trackingPeriodId: string | null;
};

function toEditableExpense(row: MoneyLedgerRow): ExpenseDto | null {
  if (row.kind !== "expense" || row.category === null || row.needVsWant === null) {
    return null;
  }
  return {
    id: row.id,
    kind: "expense",
    direction: "out",
    occurredAt: row.occurredAt,
    bookingDate: row.bookingDate,
    amountMinor: row.amountMinor,
    currency: row.currency,
    category: row.category,
    note: row.note,
    merchant: row.merchant,
    needVsWant: row.needVsWant,
    paymentMethod: row.paymentMethod,
    purpose: row.purpose as ExpenseDto["purpose"],
    countsInDaily: row.countsInDaily,
    periodId: row.periodId,
    idempotencyKey: row.idempotencyKey,
    version: row.version,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * One chronological movement history. The page performs one `listMovements`
 * query (optionally narrowed by kind before pagination), so every kind appears
 * exactly once and expense edit/soft-delete plus non-expense versioned
 * correction stay available on the same row. Failed and empty reads are
 * explicit; unavailable totals are never rendered as zero.
 */
export function MoneyHistory({
  ownerKey,
  movements,
  totals,
  totalsUnavailable,
  hasMore,
  offset,
  kind,
  kindOptions,
  periodId,
  timezone,
  selectedPeriodLabel,
  historyScopeLabel,
  scope,
  trackingPeriodId,
}: MoneyHistoryProps) {
  const pageHref = (nextOffset: number) =>
    moneyHref({ periodId, offset: nextOffset, kind, scope });
  return (
    <section
      aria-labelledby="money-history-heading"
      className="mt-6 rounded-lg border border-ega-border p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2
          id="money-history-heading"
          className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]"
        >
          Movement history
        </h2>
        <div className="text-right">
          <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            One chronological ledger for every kind. {historyScopeLabel}
          </p>
          {periodId ? (
            <a
              className="text-[length:var(--text-meta)] underline"
              href={moneyHref({
                periodId,
                offset: 0,
                kind,
                scope: scope === "all" ? "period" : "all",
              })}
            >
              {scope === "all" ? "Show this period" : "Show all history"}
            </a>
          ) : null}
        </div>
      </div>

      <form method="get" action="/money" className="mt-3 flex flex-wrap items-end gap-3">
        {periodId ? <input type="hidden" name="periodId" value={periodId} /> : null}
        {scope === "all" ? <input type="hidden" name="scope" value="all" /> : null}
        <label className="flex flex-col gap-1 text-[length:var(--text-meta)]">
          Kind
          <select name="kind" defaultValue={kind ?? ""} className="input-instrument h-9 text-sm">
            {kindOptions.map((option) => (
              <option key={option.value || "all"} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-instrument flex h-9 items-center px-3 text-sm">
          Apply filter
        </button>
        {kind ? (
          <a className="underline text-[length:var(--text-meta)]" href={moneyHref({ periodId, offset: 0, kind: null, scope })}>
            Clear filter
          </a>
        ) : null}
      </form>

      {totals ? (
        <div className="mt-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Expense spending</dt>
              <dd className="text-[length:var(--text-body)] font-medium">{formatMad(totals.expenseTotalMinor)}</dd>
            </div>
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Daily included spending</dt>
              <dd className="text-[length:var(--text-body)] font-medium">{formatMad(totals.dailyIncludedSpendMinor)}</dd>
            </div>
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Funded savings</dt>
              <dd className="text-[length:var(--text-body)] font-medium">{formatMad(totals.savingsFundedMinor)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            {totals.truncated
              ? "Totals are a lower bound (the bounded window exceeded 10,000 movements)."
              : `${totals.counts.movements} movement(s)${selectedPeriodLabel ? ` · ${selectedPeriodLabel}` : ""}.`}
          </p>
        </div>
      ) : (
        <p className="mt-4 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          {totalsUnavailable
            ? "Totals are unavailable right now. The history list below is unaffected."
            : "Totals are not available for this selection."}
        </p>
      )}

      {movements === null ? (
        <div role="alert" className="mt-4 rounded border border-ega-border p-4">
          <p>Movement history could not be loaded.</p>
          <a className="underline" href={pageHref(offset)}>Retry</a>
        </div>
      ) : movements.length === 0 ? (
        <div className="mt-4 rounded border border-ega-border p-4">
          <p className="text-[color:var(--ega-text-secondary)]">
            {kind
              ? periodId && scope === "period"
                ? "No movements of this kind are recorded in this period."
                : "No movements of this kind are recorded."
              : offset > 0
                ? "No movements on this page."
                : "No movements recorded yet. Opening cash appears here once a period is initialized."}
          </p>
          {offset > 0 ? <a className="underline" href={pageHref(Math.max(0, offset - MONEY_PAGE_SIZE))}>Previous page</a> : null}
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded border border-ega-border">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <caption className="sr-only">Money movement history</caption>
            <thead>
              <tr>
                <th scope="col" className="p-3">Date</th>
                <th scope="col" className="p-3">Kind</th>
                <th scope="col" className="p-3">Detail</th>
                <th scope="col" className="p-3">Daily spending</th>
                <th scope="col" className="p-3 text-right">Cash effect</th>
                <th scope="col" className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((row) => {
                const effect = movementEffect(row);
                const expense = toEditableExpense(row);
                const canChangeBookingDate =
                  row.periodId === null || row.periodId === trackingPeriodId;
                return (
                  <tr key={row.id} className="border-t border-ega-border" data-testid={`money-history-row-${row.id}`}>
                    <td className="p-3 tabular-nums">
                      {row.bookingDate}
                      {row.occurredAt ? (
                        <span className="block text-xs text-ega-text-secondary">
                          {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(row.occurredAt))}
                        </span>
                      ) : (
                        <span className="block text-xs text-ega-text-secondary">(time unknown)</span>
                      )}
                    </td>
                    <td className="p-3">{movementKindLabel(row.kind)}</td>
                    <td className="p-3">
                      {row.kind === "opening" ? "Opening cash (corrected in period settings)" : (row.merchant ?? "—")}
                      {row.note ? <p className="mt-1 text-xs text-ega-text-secondary">{row.note}</p> : null}
                      {row.category ? <p className="mt-1 text-xs text-ega-text-secondary">{row.category.replaceAll("_", " ")}</p> : null}
                    </td>
                    <td className="p-3">{row.kind === "expense" ? (row.countsInDaily ? "Included" : "Excluded") : "—"}</td>
                    <td className={`p-3 text-right tabular-nums ${effect.cashDeltaMinor < 0 ? "text-[color:var(--ega-danger)]" : ""}`}>
                      {formatMad(effect.cashDeltaMinor)}
                    </td>
                    <td className="p-3 text-right">
                      {row.kind === "opening" ? (
                        <span className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Period settings</span>
                      ) : expense ? (
                        <MoneyRowActions
                          ownerKey={ownerKey}
                          expense={expense}
                          canChangeBookingDate={canChangeBookingDate}
                        />
                      ) : (
                        <MoneyMovementActions
                          movement={row}
                          canChangeBookingDate={canChangeBookingDate}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {movements !== null ? (
        <nav aria-label="Movement history pages" className="mt-4 flex justify-between">
          <span>{offset > 0 ? <a className="underline" href={pageHref(Math.max(0, offset - MONEY_PAGE_SIZE))}>Previous</a> : null}</span>
          <span>{hasMore ? <a className="underline" href={pageHref(offset + MONEY_PAGE_SIZE)}>Next</a> : null}</span>
        </nav>
      ) : null}
    </section>
  );
}
