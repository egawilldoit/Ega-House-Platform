"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useStableIdempotencyKey } from "@/components/money/use-stable-expense-key";
import {
  EXPENSE_CATEGORY_OPTIONS,
  EXPENSE_NEED_VS_WANT_OPTIONS,
} from "@/lib/money/expense-form-validation";
import { parseMadAmountToMinor } from "@/lib/money/money-amount";
import type { MoneyMovementDto } from "@ega/contracts/money";

import { createMovementAction } from "../actions";

type MovementKind = Exclude<MoneyMovementDto["kind"], "opening">;

const KIND_OPTIONS: ReadonlyArray<{ value: MovementKind; label: string }> = [
  { value: "income", label: "Income received" },
  { value: "savings_transfer", label: "Savings transfer" },
  { value: "expense", label: "Expense" },
  { value: "reconciliation_adjustment", label: "Reconciliation adjustment" },
];

const FIELD_LABEL = "form-label";

function todayLocalDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** `datetime-local` has no offset; resolve it in the browser's local zone. */
function localDateTimeToIso(value: string): string {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : value;
}

/**
 * MONEY-04 manual movement form for income, savings transfers, adjustments and
 * (when desired) expenses. It composes the shared `createMovementAction`, so
 * parsing, defaults, owner scope and the idempotency receipt match the MCP and
 * HTTP surfaces exactly. A date-only booking keeps occurrence time unknown.
 */
export function MoneyMovementPanel({
  ownerKey,
  defaultBookingDate,
}: {
  ownerKey: string;
  defaultBookingDate?: string;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<MovementKind>("income");
  const [idempotencyKey, rotateKey] = useStableIdempotencyKey({
    ownerKey,
    purchaseNonce: "movement",
  });
  const [amountInput, setAmountInput] = useState("");
  const [bookingDate, setBookingDate] = useState(
    () => defaultBookingDate ?? todayLocalDate(),
  );
  const [knownTime, setKnownTime] = useState("");
  const [category, setCategory] = useState("");
  const [needVsWant, setNeedVsWant] = useState("");
  const [purpose, setPurpose] = useState("");
  const [dailyOverride, setDailyOverride] = useState("default");
  const [note, setNote] = useState("");
  const [merchant, setMerchant] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ replayed: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const errorRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (formError) errorRef.current?.focus();
  }, [formError]);

  function resetForNext() {
    rotateKey();
    setAmountInput("");
    setNote("");
    setMerchant("");
    setKnownTime("");
    setDailyOverride("default");
    setFormError(null);
    setSuccess(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pendingRef.current) return;
    setFormError(null);

    const amount = parseMadAmountToMinor(amountInput);
    if (!amount.ok) {
      setFormError(amount.error);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) {
      setFormError("Choose the booking date this movement belongs to.");
      return;
    }
    if (kind === "expense" && (!category || !needVsWant)) {
      setFormError("An expense needs a category and a need or want classification.");
      return;
    }

    pendingRef.current = true;
    setPending(true);
    try {
      const result = await createMovementAction({
        kind,
        amountMinor: amount.value,
        bookingDate,
        ...(knownTime ? { occurredAt: localDateTimeToIso(knownTime) } : {}),
        ...(kind === "expense"
          ? {
              category: category as MoneyMovementDto["category"],
              needVsWant: needVsWant as MoneyMovementDto["needVsWant"],
              ...(purpose ? { purpose: purpose as MoneyMovementDto["purpose"] } : {}),
            }
          : {}),
        ...(dailyOverride === "default"
          ? {}
          : { countsInDaily: dailyOverride === "true" }),
        note: note.trim() ? note : null,
        merchant: merchant.trim() ? merchant : null,
        idempotencyKey,
      });
      if (result.ok) {
        setSuccess({ replayed: result.replayed });
        router.refresh();
      } else {
        setFormError(result.error);
      }
    } catch {
      setFormError(
        "Unable to record this movement right now. Retry — the same key cannot duplicate it.",
      );
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  const defaultDaily = kind === "expense";

  return (
    <section
      aria-labelledby="money-movement-heading"
      className="mt-6 rounded-lg border border-ega-border p-5"
    >
      <h2
        id="money-movement-heading"
        className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]"
      >
        Record income or savings movement
      </h2>
      <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
        One ledger for cash: income is a posted inflow, a savings transfer moves
        spendable cash into funded savings once, and an adjustment corrects the
        recorded model. Choose “As booked” to keep occurrence time unknown.
      </p>
      <form onSubmit={handleSubmit} aria-label="Record money movement" className="mt-4 flex flex-col gap-4" noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="movement-kind" className={FIELD_LABEL}>Kind</label>
            <select
              id="movement-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as MovementKind)}
              disabled={pending || success !== null}
              className="input-instrument h-11 w-full text-sm"
            >
              {KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor="movement-amount" className={FIELD_LABEL}>Amount (MAD)</label>
            <Input
              id="movement-amount"
              inputMode="decimal"
              placeholder="200.00"
              required
              value={amountInput}
              onChange={(event) => setAmountInput(event.target.value)}
              disabled={pending || success !== null}
              className="h-11 w-full"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="movement-booking-date" className={FIELD_LABEL}>Booking date</label>
            <Input
              id="movement-booking-date"
              type="date"
              required
              value={bookingDate}
              onChange={(event) => setBookingDate(event.target.value)}
              disabled={pending || success !== null}
              className="h-11 w-full"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="movement-time" className={FIELD_LABEL}>
              Exact time <span className="font-normal">(optional)</span>
            </label>
            <Input
              id="movement-time"
              type="datetime-local"
              value={knownTime}
              onChange={(event) => setKnownTime(event.target.value)}
              disabled={pending || success !== null}
              className="h-11 w-full"
            />
            <p className="text-xs text-[color:var(--muted-foreground)]">
              Leave empty when only the day is known.
            </p>
          </div>
          <div className="space-y-2">
            <label htmlFor="movement-daily" className={FIELD_LABEL}>Counts in daily spending</label>
            <select
              id="movement-daily"
              value={dailyOverride}
              onChange={(event) => setDailyOverride(event.target.value)}
              disabled={pending || success !== null}
              className="input-instrument h-11 w-full text-sm"
            >
              <option value="default">Default ({defaultDaily ? "yes" : "no"})</option>
              <option value="true">Yes — daily spending</option>
              <option value="false">No — cash only</option>
            </select>
          </div>
          {kind === "expense" ? (
            <>
              <div className="space-y-2">
                <label htmlFor="movement-category" className={FIELD_LABEL}>Category</label>
                <select
                  id="movement-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  disabled={pending || success !== null}
                  className="input-instrument h-11 w-full text-sm"
                >
                  <option value="">Select a category</option>
                  {EXPENSE_CATEGORY_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="movement-need" className={FIELD_LABEL}>Need or want</label>
                <select
                  id="movement-need"
                  value={needVsWant}
                  onChange={(event) => setNeedVsWant(event.target.value)}
                  disabled={pending || success !== null}
                  className="input-instrument h-11 w-full text-sm"
                >
                  <option value="">Select need or want</option>
                  {EXPENSE_NEED_VS_WANT_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="movement-purpose" className={FIELD_LABEL}>
                  Purpose <span className="font-normal">(optional)</span>
                </label>
                <select
                  id="movement-purpose"
                  value={purpose}
                  onChange={(event) => setPurpose(event.target.value)}
                  disabled={pending || success !== null}
                  className="input-instrument h-11 w-full text-sm"
                >
                  <option value="">No purpose</option>
                  <option value="fixed">Fixed</option>
                  <option value="flexible">Flexible</option>
                  <option value="emergency">Emergency</option>
                </select>
              </div>
            </>
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="movement-merchant" className={FIELD_LABEL}>
              Source <span className="font-normal">(optional)</span>
            </label>
            <Input
              id="movement-merchant"
              value={merchant}
              onChange={(event) => setMerchant(event.target.value)}
              disabled={pending || success !== null}
              className="h-11 w-full"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="movement-note" className={FIELD_LABEL}>
              Note <span className="font-normal">(optional)</span>
            </label>
            <Textarea
              id="movement-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={pending || success !== null}
              className="min-h-20 w-full resize-none"
            />
          </div>
        </div>

        {success ? (
          <p role="status" aria-live="polite" className="feedback-block">
            {success.replayed
              ? "This movement was already recorded. The retry confirmed the existing row; no duplicate was created."
              : "Movement recorded."}{" "}
            Use “Record another” for a genuinely new movement.
          </p>
        ) : null}
        {formError ? (
          <p ref={errorRef} role="alert" tabIndex={-1} className="feedback-block feedback-block-error">
            {formError}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" size="lg" disabled={pending || success !== null} aria-busy={pending}>
            {pending ? "Recording…" : success ? "Recorded" : "Record movement"}
          </Button>
          <Button type="button" variant="ghost" size="md" onClick={resetForNext} disabled={pending}>
            Record another
          </Button>
        </div>
      </form>
    </section>
  );
}
