"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type {
  MoneyDayCloseDto,
  MoneyDayCloseStateDto,
  MoneyPeriodDto,
} from "@ega/contracts/money";
import {
  EXPENSE_CATEGORY_LABELS,
} from "@ega/domain/money";
import {
  EXPENSE_CATEGORY_VALUES,
  type ExpenseCategory,
} from "@ega/domain/expenses";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { Input } from "@/components/ui/input";
import { createExpenseIdempotencyKey } from "@/lib/money/expense-idempotency";
import { formatMinorToMad, parseMadAmountToMinor } from "@/lib/money/money-amount";

type MoneyFormActionResult =
  | { ok: true; error: null }
  | { ok: false; error: string };

type FinalPurchaseRow = {
  rowKey: number;
  idempotencyKey: string;
  amount: string;
  category: ExpenseCategory;
  needVsWant: "need" | "want";
  purpose: "" | "fixed" | "flexible" | "emergency";
  countsInDaily: "" | "included" | "excluded";
  note: string;
};

type Props = {
  period: MoneyPeriodDto;
  /** Close evidence for the resolved active date, if that day was closed. */
  dayClose: MoneyDayCloseStateDto | null;
  /** Latest retained close (the active day may already be the next day). */
  lastClose: MoneyDayCloseStateDto | null;
  recentCloses: readonly MoneyDayCloseDto[];
  dayClosesUnavailable: boolean;
  action: (formData: FormData) => Promise<MoneyFormActionResult>;
};

function newRow(key: number): FinalPurchaseRow {
  return {
    rowKey: key,
    idempotencyKey: createExpenseIdempotencyKey(),
    amount: "",
    category: "groceries",
    needVsWant: "need",
    purpose: "",
    countsInDaily: "",
    note: "",
  };
}

/** Close identity must be a UUID; keep a safe fallback for restricted runtimes. */
function createCloseOperationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function formatInstant(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/**
 * MONEY-09 close control.
 *
 * The close is a durable snapshot plus one active-date advance, never a
 * status-only note. Final purchases are part of the same request: their stable
 * keys are generated once per row and kept across retries, so a failed close
 * can be retried without duplicating a committed purchase. Retained close
 * evidence is displayed beside restated live totals when a later correction
 * changed the day.
 */
export function MoneyDayClosePanel({
  period,
  dayClose,
  lastClose,
  recentCloses,
  dayClosesUnavailable,
  action,
}: Props) {
  const router = useRouter();
  const [operationId, setOperationId] = useState(() => createCloseOperationId());
  const [rows, setRows] = useState<FinalPurchaseRow[]>([]);
  const [nextRowKey, setNextRowKey] = useState(1);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const evidence = dayClose ?? lastClose;
  const comparison = evidence?.comparison ?? null;
  const tracking = period.lifecycle === "tracking";

  function updateRow(key: number, patch: Partial<FinalPurchaseRow>) {
    setRows((current) =>
      current.map((row) => (row.rowKey === key ? { ...row, ...patch } : row)),
    );
  }

  function addRow() {
    setRows((current) => [...current, newRow(nextRowKey)]);
    setNextRowKey((value) => value + 1);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const formData = new FormData();
    formData.set("periodId", period.id);
    formData.set("version", String(period.version));
    formData.set("date", period.activeDate);
    formData.set("operationId", operationId);
    if (note.trim()) formData.set("note", note.trim());
    formData.set("finalPurchaseCount", String(rows.length));
    for (const [index, row] of rows.entries()) {
      const amount = parseMadAmountToMinor(row.amount);
      if (!amount.ok) {
        setError(`Final purchase ${index + 1}: ${amount.error}`);
        return;
      }
      formData.set(`final:${index}:amount`, row.amount);
      formData.set(`final:${index}:category`, row.category);
      formData.set(`final:${index}:needVsWant`, row.needVsWant);
      formData.set(`final:${index}:idempotencyKey`, row.idempotencyKey);
      if (row.purpose) formData.set(`final:${index}:purpose`, row.purpose);
      if (row.countsInDaily) {
        formData.set(`final:${index}:countsInDaily`, row.countsInDaily);
      }
      if (row.note.trim()) formData.set(`final:${index}:note`, row.note.trim());
    }

    setPending(true);
    try {
      const result = await action(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess(
        `Closed ${period.activeDate}. The active date advanced once; the retained snapshot is shown below.`,
      );
      setRows([]);
      setNote("");
      setOperationId(createCloseOperationId());
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="money-day-close-heading" className="mt-6 rounded-lg border border-ega-border p-5">
      <h2 id="money-day-close-heading" className="text-[length:var(--text-section)] font-semibold">
        Close the day
      </h2>
      <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
        Active tracking date: <span className="font-medium">{period.activeDate}</span>
        {" "}(period {period.startDate} to {period.endDate}). A close stores the CLOSED note and
        the retained cash/reference/reserve snapshot, then advances the active date exactly one day.
        It never changes savings, budgets or carryover.
      </p>

      {tracking ? (
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[length:var(--text-meta)]">
            CLOSED note (optional)
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              rows={2}
              className="rounded border border-ega-border bg-transparent px-2 py-1 text-[length:var(--text-body)]"
              placeholder="What happened on this day?"
            />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={addRow}
              className="rounded border border-ega-border px-3 py-1 text-[length:var(--text-meta)]"
            >
              Add final purchase
            </button>
            <span className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
              Included in the same close request; each row has a stable retry identity.
            </span>
          </div>

          {rows.length > 0 ? (
            <ol className="flex flex-col gap-3">
              {rows.map((row, index) => (
                <li key={row.rowKey} className="rounded border border-ega-border p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-[length:var(--text-meta)]">
                      Amount (MAD)
                      <Input
                        value={row.amount}
                        onChange={(event) => updateRow(row.rowKey, { amount: event.target.value })}
                        inputMode="decimal"
                        placeholder="11.00"
                        aria-label={`Final purchase ${index + 1} amount`}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[length:var(--text-meta)]">
                      Category
                      <select
                        value={row.category}
                        onChange={(event) =>
                          updateRow(row.rowKey, {
                            category: event.target.value as ExpenseCategory,
                          })
                        }
                        className="rounded border border-ega-border bg-transparent px-2 py-1 text-[length:var(--text-body)]"
                      >
                        {EXPENSE_CATEGORY_VALUES.map((category) => (
                          <option key={category} value={category}>
                            {EXPENSE_CATEGORY_LABELS[category]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-[length:var(--text-meta)]">
                      Need or want
                      <select
                        value={row.needVsWant}
                        onChange={(event) =>
                          updateRow(row.rowKey, {
                            needVsWant: event.target.value as "need" | "want",
                          })
                        }
                        className="rounded border border-ega-border bg-transparent px-2 py-1 text-[length:var(--text-body)]"
                      >
                        <option value="need">Need</option>
                        <option value="want">Want</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-[length:var(--text-meta)]">
                      Purpose
                      <select
                        value={row.purpose}
                        onChange={(event) =>
                          updateRow(row.rowKey, {
                            purpose: event.target.value as FinalPurchaseRow["purpose"],
                          })
                        }
                        className="rounded border border-ega-border bg-transparent px-2 py-1 text-[length:var(--text-body)]"
                      >
                        <option value="">Unspecified</option>
                        <option value="flexible">Flexible</option>
                        <option value="fixed">Fixed</option>
                        <option value="emergency">Emergency</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-[length:var(--text-meta)]">
                      Daily spending
                      <select
                        value={row.countsInDaily}
                        onChange={(event) =>
                          updateRow(row.rowKey, {
                            countsInDaily: event.target.value as FinalPurchaseRow["countsInDaily"],
                          })
                        }
                        className="rounded border border-ega-border bg-transparent px-2 py-1 text-[length:var(--text-body)]"
                      >
                        <option value="">Default (included)</option>
                        <option value="included">Included</option>
                        <option value="excluded">Excluded</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-[length:var(--text-meta)]">
                      Description
                      <Input
                        value={row.note}
                        onChange={(event) => updateRow(row.rowKey, { note: event.target.value })}
                        maxLength={500}
                        aria-label={`Final purchase ${index + 1} description`}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRows((current) => current.filter((item) => item.rowKey !== row.rowKey))}
                    className="mt-2 text-[length:var(--text-meta)] underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ol>
          ) : null}

          {error ? <p role="alert" className="text-[color:var(--ega-danger)]">{error}</p> : null}
          {success ? <p role="status">{success}</p> : null}
          <div>
            <PendingSubmitButton pendingLabel="Closing…" disabled={pending}>
              {pending ? "Closing…" : `Close ${period.activeDate}`}
            </PendingSubmitButton>
          </div>
          <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            The close needs complete day-start inputs. If the baseline is unavailable, complete or
            explicitly rebase it first; a close is never based on an invented zero.
          </p>
        </form>
      ) : (
        <p role="status" className="mt-3 text-[length:var(--text-body)]">
          This period is {period.lifecycle.replaceAll("_", " ")} and requires rollover before a new
          routine day can be closed. Historical corrections remain available through the versioned
          movement path.
        </p>
      )}

      {dayClosesUnavailable ? (
        <p role="status" className="mt-4 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          Retained close evidence is unavailable right now; no unchanged/closed claim is made.
        </p>
      ) : null}

      {evidence ? (
        <div className="mt-5 rounded border border-ega-border p-3" aria-labelledby="money-day-close-evidence-heading">
          <h3 id="money-day-close-evidence-heading" className="font-semibold">
            {evidence.close.isFinalDay ? "Final day close" : "Retained close"} — {evidence.close.closeDate}
          </h3>
          <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Closed at {formatInstant(evidence.close.createdAt)} by operation{" "}
            <span className="font-mono">{evidence.close.operationId}</span>.{" "}
            {evidence.close.isFinalDay
              ? "Last tracked date retained; period is ended and needs explicit rollover."
              : `Active date advanced to ${evidence.close.activeDateAfter}.`}
          </p>
          {evidence.close.note ? <p className="mt-2">{evidence.close.note}</p> : null}
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            <div>
              <dt>Day spending (original)</dt>
              <dd className="font-semibold">{formatMinorToMad(evidence.close.snapshot.expenseTotalMinor)}</dd>
            </div>
            <div>
              <dt>Daily included spending (original)</dt>
              <dd className="font-semibold">{formatMinorToMad(evidence.close.snapshot.dailyIncludedSpendMinor)}</dd>
            </div>
            <div>
              <dt>Recorded cash at close (original)</dt>
              <dd className="font-semibold">{formatMinorToMad(evidence.close.snapshot.recordedCashMinor)}</dd>
            </div>
            <div>
              <dt>Day-start reference (original)</dt>
              <dd className="font-semibold">
                {evidence.close.snapshot.dailyReference.available
                  ? formatMinorToMad(evidence.close.snapshot.dailyReference.referenceMinor)
                  : "Unavailable"}
              </dd>
            </div>
            <div>
              <dt>Daily remaining (original)</dt>
              <dd className="font-semibold">
                {evidence.close.snapshot.dailyReference.available
                  ? formatMinorToMad(evidence.close.snapshot.dailyReference.dailyRemainingMinor)
                  : "Unavailable"}
              </dd>
            </div>
            <div>
              <dt>Algorithm / baseline</dt>
              <dd className="font-semibold">
                {evidence.close.algorithmVersion} · v{evidence.close.baselineVersion}
              </dd>
            </div>
          </dl>
          {comparison?.available ? (
            comparison.changed ? (
              <div className="mt-3 rounded border border-ega-border p-2">
                <p role="status" className="font-medium">
                  Changed since close: {comparison.changedFields.join(", ")}
                </p>
                <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>
                    <dt>Day spending (restated)</dt>
                    <dd className="font-semibold">
                      {formatMinorToMad(comparison.restated.expenseTotalMinor)}
                    </dd>
                  </div>
                  <div>
                    <dt>Daily included (restated)</dt>
                    <dd className="font-semibold">
                      {formatMinorToMad(comparison.restated.dailyIncludedSpendMinor)}
                    </dd>
                  </div>
                  <div>
                    <dt>Recorded cash (restated)</dt>
                    <dd className="font-semibold">
                      {comparison.restated.recordedCashMinor === null
                        ? "Unavailable"
                        : formatMinorToMad(comparison.restated.recordedCashMinor)}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : (
              <p role="status" className="mt-3 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                Live totals still match the retained close.
              </p>
            )
          ) : (
            <p role="status" className="mt-3 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
              Restated live totals are unavailable ({comparison?.reason ?? "unknown"}); the original
              close is retained unchanged.
            </p>
          )}
        </div>
      ) : null}

      {recentCloses.length > 1 ? (
        <div className="mt-4">
          <h3 className="font-semibold">Recent closes</h3>
          <ul className="mt-2 flex flex-col gap-1 text-[length:var(--text-meta)]">
            {recentCloses.map((close) => (
              <li key={close.id}>
                {close.closeDate} — {close.isFinalDay ? "final day" : `advanced to ${close.activeDateAfter}`}
                {close.note ? ` — ${close.note}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
