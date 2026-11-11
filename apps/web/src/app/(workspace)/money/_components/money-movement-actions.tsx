"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseMadAmountToMinor, formatMinorToMadInput } from "@/lib/money/money-amount";
import type { MoneyMovementDto } from "@ega/contracts/money";

import { updateMovementAction } from "../actions";

/**
 * MONEY-04 correction control for a non-expense movement. Corrections use the
 * shared optimistic-version update, so a stale writer never overwrites a newer
 * amount and a restated savings transfer restores the same cash/savings
 * invariants. Expense rows are edited by the existing expense controls.
 */
export function MoneyMovementActions({ movement }: { movement: MoneyMovementDto }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amountInput, setAmountInput] = useState(formatMinorToMadInput(movement.amountMinor));
  const [bookingDate, setBookingDate] = useState(movement.bookingDate);
  const [note, setNote] = useState(movement.note ?? "");
  const [merchant, setMerchant] = useState(movement.merchant ?? "");
  const [countsInDaily, setCountsInDaily] = useState(movement.countsInDaily ? "true" : "false");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function toggleDailyInclusion() {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const result = await updateMovementAction(movement.id, {
        version: movement.version,
        countsInDaily: !movement.countsInDaily,
      });
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error);
      }
    } catch {
      setError("Unable to change daily inclusion right now.");
    } finally {
      setPending(false);
    }
  }

  if (movement.kind === "expense") {
    return (
      <div className="text-right">
        <Button
          type="button"
          size="sm"
          variant="muted"
          onClick={toggleDailyInclusion}
          disabled={pending}
          aria-pressed={movement.countsInDaily}
          data-testid={`movement-daily-toggle-${movement.id}`}
        >
          {pending
            ? "Saving…"
            : movement.countsInDaily
              ? "Exclude from daily"
              : "Include in daily"}
        </Button>
        {error ? <p role="alert" className="mt-1 text-xs text-[var(--signal-error)]">{error}</p> : null}
      </div>
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const amount = parseMadAmountToMinor(amountInput);
    if (!amount.ok) {
      setError(amount.error);
      return;
    }
    setError(null);
    setPending(true);
    try {
      const result = await updateMovementAction(movement.id, {
        version: movement.version,
        amountMinor: amount.value,
        bookingDate,
        note: note.trim() ? note : null,
        merchant: merchant.trim() ? merchant : null,
        countsInDaily: countsInDaily === "true",
      });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    } catch {
      setError("Unable to save this correction right now.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <Button
        type="button"
        size="sm"
        variant="muted"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {open ? "Close" : "Correct"}
      </Button>
      {open ? (
        <form onSubmit={handleSubmit} className="mt-3 flex flex-wrap items-end gap-2" aria-label="Correct movement">
          <div className="space-y-1">
            <label htmlFor={`movement-amount-${movement.id}`} className="text-xs text-[color:var(--ega-text-secondary)]">Amount (MAD)</label>
            <Input
              id={`movement-amount-${movement.id}`}
              inputMode="decimal"
              value={amountInput}
              onChange={(event) => setAmountInput(event.target.value)}
              disabled={pending}
              className="h-9 w-28"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={`movement-date-${movement.id}`} className="text-xs text-[color:var(--ega-text-secondary)]">Booking date</label>
            <Input
              id={`movement-date-${movement.id}`}
              type="date"
              value={bookingDate}
              onChange={(event) => setBookingDate(event.target.value)}
              disabled={pending}
              className="h-9 w-40"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={`movement-note-${movement.id}`} className="text-xs text-[color:var(--ega-text-secondary)]">Note</label>
            <Input
              id={`movement-note-${movement.id}`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={pending}
              className="h-9 w-44"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={`movement-source-${movement.id}`} className="text-xs text-[color:var(--ega-text-secondary)]">Source</label>
            <Input
              id={`movement-source-${movement.id}`}
              value={merchant}
              onChange={(event) => setMerchant(event.target.value)}
              disabled={pending}
              className="h-9 w-36"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={`movement-daily-${movement.id}`} className="text-xs text-[color:var(--ega-text-secondary)]">Daily spending</label>
            <select
              id={`movement-daily-${movement.id}`}
              value={countsInDaily}
              onChange={(event) => setCountsInDaily(event.target.value)}
              disabled={pending}
              className="input-instrument h-9 text-sm"
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
          <Button type="submit" size="sm" variant="primary" disabled={pending}>
            {pending ? "Saving…" : "Save correction"}
          </Button>
          {error ? <p role="alert" className="w-full text-sm text-[var(--signal-error)]">{error}</p> : null}
        </form>
      ) : null}
    </div>
  );
}
