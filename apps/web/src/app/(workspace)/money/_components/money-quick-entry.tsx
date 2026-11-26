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
import { defaultCountsInDaily, type MoneyPurpose } from "@ega/domain/money";
import type { ExpenseCategory } from "@ega/domain/expenses";
import type { MoneyMovementDto } from "@ega/contracts/money";

import { createMovementAction } from "../actions";

type MovementKind = Exclude<MoneyMovementDto["kind"], "opening">;

const KIND_OPTIONS: ReadonlyArray<{ value: MovementKind; label: string }> = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income received" },
  { value: "savings_transfer", label: "Savings transfer" },
  { value: "reconciliation_adjustment", label: "Reconciliation adjustment" },
];

const FIELD_LABEL = "form-label";

/**
 * The one primary Money creation affordance. Every kind posts through the
 * canonical `createMovementAction` use case with a stable idempotency key, so
 * the Money page has one write path and the same owner/period/retry semantics
 * as HTTP and MCP. Expense is the default because it is the everyday action.
 */
export function MoneyQuickEntry({
  ownerKey,
  defaultBookingDate,
}: {
  ownerKey: string;
  defaultBookingDate: string;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<MovementKind>("expense");
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [idempotencyKey, rotateKey] = useStableIdempotencyKey({
    ownerKey,
    purchaseNonce: "money-quick-entry",
  });
  const [amountInput, setAmountInput] = useState("");
  const [bookingDate, setBookingDate] = useState(defaultBookingDate);
  const [knownTime, setKnownTime] = useState("");
  const [category, setCategory] = useState("");
  const [needVsWant, setNeedVsWant] = useState("");
  const [purpose, setPurpose] = useState("");
  const [dailyOverride, setDailyOverride] = useState("default");
  const [paymentMethod, setPaymentMethod] = useState("");
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
    setPurpose("");
    setPaymentMethod("");
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
    if (knownTime && knownTime.slice(0, 10) !== bookingDate) {
      setFormError("The exact time must fall on the selected booking date.");
      return;
    }

    pendingRef.current = true;
    setPending(true);
    try {
      const result = await createMovementAction({
        kind,
        ...(kind === "reconciliation_adjustment" ? { direction } : {}),
        amountMinor: amount.value,
        bookingDate,
        // The datetime-local value has no timezone. Send the wall time as
        // entered; the server converts it with the verified period/owner zone.
        ...(knownTime ? { occurredAtWallTime: knownTime } : {}),
        ...(kind === "expense"
          ? {
              category: category as MoneyMovementDto["category"],
              needVsWant: needVsWant as MoneyMovementDto["needVsWant"],
              ...(purpose ? { purpose: purpose as MoneyMovementDto["purpose"] } : {}),
              paymentMethod: (paymentMethod || null) as MoneyMovementDto["paymentMethod"],
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

  const defaultDaily = defaultCountsInDaily(
    kind,
    purpose ? (purpose as MoneyPurpose) : null,
    category ? (category as ExpenseCategory) : null,
  );

  return (
    <section
      aria-labelledby="money-quick-entry-heading"
      className="mt-6 rounded-lg border border-ega-border p-5"
    >
      <h2
        id="money-quick-entry-heading"
        className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]"
      >
        Quick entry
      </h2>
      <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
        One durable ledger write. An expense reduces recorded cash once; income is an
        independent inflow; a savings transfer moves cash into funded savings once; a
        reconciliation adjustment corrects the recorded model explicitly.
      </p>
      <form onSubmit={handleSubmit} aria-label="Quick financial entry" className="mt-4 flex flex-col gap-4" noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="quick-kind" className={FIELD_LABEL}>Kind</label>
            <select
              id="quick-kind"
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
          {kind === "reconciliation_adjustment" ? (
            <div className="space-y-2">
              <label htmlFor="quick-direction" className={FIELD_LABEL}>Direction</label>
              <select
                id="quick-direction"
                value={direction}
                onChange={(event) => setDirection(event.target.value as "in" | "out")}
                disabled={pending || success !== null}
                className="input-instrument h-11 w-full text-sm"
              >
                <option value="out">Outflow (reduces cash)</option>
                <option value="in">Inflow (increases cash)</option>
              </select>
            </div>
          ) : null}
          <div className="space-y-2">
            <label htmlFor="quick-amount" className={FIELD_LABEL}>Amount (MAD)</label>
            <Input
              id="quick-amount"
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
            <label htmlFor="quick-booking-date" className={FIELD_LABEL}>Booking date</label>
            <Input
              id="quick-booking-date"
              type="date"
              required
              value={bookingDate}
              onChange={(event) => setBookingDate(event.target.value)}
              disabled={pending || success !== null}
              className="h-11 w-full"
            />
            <p className="text-xs text-[color:var(--muted-foreground)]">
              Owner-local date. A later valid date works even when earlier days are unclosed.
            </p>
          </div>
          {kind === "expense" ? (
            <>
              <div className="space-y-2">
                <label htmlFor="quick-category" className={FIELD_LABEL}>Category</label>
                <select
                  id="quick-category"
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
                <label htmlFor="quick-need" className={FIELD_LABEL}>Need or want</label>
                <select
                  id="quick-need"
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
            </>
          ) : null}
          <div className="space-y-2">
            <label htmlFor="quick-merchant" className={FIELD_LABEL}>
              Source <span className="font-normal">(optional)</span>
            </label>
            <Input
              id="quick-merchant"
              value={merchant}
              onChange={(event) => setMerchant(event.target.value)}
              disabled={pending || success !== null}
              className="h-11 w-full"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <label htmlFor="quick-note" className={FIELD_LABEL}>
              Note <span className="font-normal">(optional)</span>
            </label>
            <Textarea
              id="quick-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={pending || success !== null}
              className="min-h-20 w-full resize-none"
            />
          </div>
        </div>

        <details className="rounded border border-ega-border p-3">
          <summary className="cursor-pointer text-[length:var(--text-meta)] font-medium">
            More options
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="quick-time" className={FIELD_LABEL}>
                Exact time <span className="font-normal">(optional)</span>
              </label>
              <Input
                id="quick-time"
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
              <label htmlFor="quick-daily" className={FIELD_LABEL}>Counts in daily spending</label>
              <select
                id="quick-daily"
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
                  <label htmlFor="quick-purpose" className={FIELD_LABEL}>
                    Purpose <span className="font-normal">(optional)</span>
                  </label>
                  <select
                    id="quick-purpose"
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
                <div className="space-y-2">
                  <label htmlFor="quick-payment" className={FIELD_LABEL}>
                    Payment method <span className="font-normal">(metadata)</span>
                  </label>
                  <select
                    id="quick-payment"
                    value={paymentMethod}
                    onChange={(event) => setPaymentMethod(event.target.value)}
                    disabled={pending || success !== null}
                    className="input-instrument h-11 w-full text-sm"
                  >
                    <option value="">Not recorded</option>
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="bank_transfer">Bank transfer</option>
                    <option value="mobile_wallet">Mobile wallet</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </>
            ) : null}
          </div>
        </details>

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
