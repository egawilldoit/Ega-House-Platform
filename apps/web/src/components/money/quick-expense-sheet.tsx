"use client";

import { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  EXPENSE_CATEGORY_OPTIONS,
  EXPENSE_NEED_VS_WANT_OPTIONS,
  EXPENSE_PAYMENT_METHOD_OPTIONS,
  validateExpenseFormValues,
  type ValidatedExpenseFormValues,
} from "@/lib/money/expense-form-validation";
import type { ExpenseDto } from "@ega/contracts/expenses";

import { useStableIdempotencyKey } from "./use-stable-expense-key";
import { useExpenseRequestScope } from "./use-expense-request-scope";

export type QuickExpenseSubmitInput = ValidatedExpenseFormValues & {
  idempotencyKey: string;
};

export type QuickExpenseSubmitResult =
  | { ok: true; expense: ExpenseDto; replayed: boolean }
  | { ok: false; code?: string; error: string };

export type QuickExpenseSheetProps = {
  ownerKey: string;
  submitExpense: (input: QuickExpenseSubmitInput) => Promise<QuickExpenseSubmitResult>;
  onCreated?: (expense: ExpenseDto, replayed: boolean) => void;
};

const QUICK_CATEGORIES = ["coffee", "groceries", "eating_out", "transport", "other"] as const;
type QuickCategory = (typeof QUICK_CATEGORIES)[number];

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}

function defaultsKey(ownerKey: string, category: string): string {
  return `ega:quick-expense:defaults:${ownerKey}:${category}`;
}

function readRememberedAmount(ownerKey: string, category: string): string {
  try {
    return window.localStorage.getItem(defaultsKey(ownerKey, category)) ?? "";
  } catch {
    return "";
  }
}

function rememberAmount(ownerKey: string, category: string, amountInput: string) {
  try {
    window.localStorage.setItem(defaultsKey(ownerKey, category), amountInput);
  } catch {
    // Remembered defaults are optional; storage failures never block saving.
  }
}

/**
 * Amount-first quick expense sheet (PO-07, issue #348). One stable
 * idempotency key per logical purchase survives double taps, timeouts and
 * retries; a successful save rotates the key for the next purchase. Failures
 * keep every field visible for an explicit retry. No offline queue: an
 * unsent form is never presented as durable success.
 */
export function QuickExpenseSheet({ ownerKey, submitExpense, onCreated }: QuickExpenseSheetProps) {
  const captureRequestScope = useExpenseRequestScope(ownerKey);
  const [open, setOpen] = useState(false);
  const [idempotencyKey, rotateKey] = useStableIdempotencyKey({
    ownerKey,
    purchaseNonce: "quick",
  });
  const [amountInput, setAmountInput] = useState("");
  const [category, setCategory] = useState<QuickCategory | "">("coffee");
  const [needVsWant, setNeedVsWant] = useState("want");
  const [merchant, setMerchant] = useState("");
  const [note, setNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);

  // Prefill the remembered amount for the selected category (e.g. 22 MAD for
  // coffee) only while the amount field is untouched.
  useEffect(() => {
    if (!open || !category) return;
    const remembered = readRememberedAmount(ownerKey, category);
    if (remembered && !amountInput) {
      setAmountInput(remembered);
    }
  }, [open, category, ownerKey, amountInput]);

  function openSheet() {
    const activeElement = document.activeElement;
    lastFocusedElementRef.current =
      activeElement instanceof HTMLElement && activeElement !== document.body
        ? activeElement
        : null;
    captureRequestScope();
    setFormError(null);
    setSuccess(false);
    setOpen(true);
  }

  function closeSheet() {
    setOpen(false);
    if (success) {
      setAmountInput("");
      setMerchant("");
      setNote("");
      setFormError(null);
      setSuccess(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    setFormError(null);
    // occurredAt is "now" for quick entry; the server re-validates everything.
    const nowDate = new Date();
    const occurredAtInput = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, "0")}-${String(nowDate.getDate()).padStart(2, "0")}T${String(nowDate.getHours()).padStart(2, "0")}:${String(nowDate.getMinutes()).padStart(2, "0")}`;
    const validation = validateExpenseFormValues({
      amountInput,
      occurredAtInput,
      category,
      needVsWant,
      merchant,
      note,
      paymentMethod,
    });
    if (!validation.ok) {
      const { occurredAtInput: _occurred, ...fieldErrors } = validation.fieldErrors;
      setFieldErrors(fieldErrors);
      return;
    }
    setFieldErrors({});
    submittingRef.current = true;
    setIsSubmitting(true);
    const values = validation.value;
    try {
      const result = await submitExpense({ ...values, idempotencyKey });
      if (!result.ok) {
        // Keep the same key: a retry (including after a timeout-after-commit)
        // must land on the original record, never a duplicate.
        setFormError(result.error);
        return;
      }
      rememberAmount(ownerKey, category || "other", amountInput);
      setSuccess(true);
      rotateKey();
      onCreated?.(result.expense, result.replayed);
    } catch {
      setFormError("The expense could not be saved right now. Your entries are still here — retry keeps the same purchase.");
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          closeSheet();
          return;
        }
        setOpen(true);
      }}
    >
      <DialogPrimitive.Trigger asChild>
        <Button type="button" className="min-h-11" onClick={openSheet}>
          Quick expense
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-[var(--ega-overlay)] backdrop-blur-[1px]" />
        <DialogPrimitive.Content
          role="dialog"
          aria-labelledby="quick-expense-title"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById("quick-expense-amount")?.focus();
          }}
          onCloseAutoFocus={(event) => {
            const last = lastFocusedElementRef.current;
            if (last?.isConnected) {
              event.preventDefault();
              last.focus();
            }
            lastFocusedElementRef.current = null;
          }}
          className="fixed inset-x-0 bottom-0 z-[100] max-h-[92dvh] overflow-y-auto rounded-t-2xl border border-[var(--ega-border)] bg-[var(--ega-surface)] p-5 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[26rem] sm:rounded-2xl"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogPrimitive.Title id="quick-expense-title" className="text-[length:var(--text-panel-title)] font-semibold">
                Quick expense
              </DialogPrimitive.Title>
              <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                Amount first. One purchase, one record — retries never duplicate.
              </p>
            </div>
            <DialogPrimitive.Close asChild>
              <Button type="button" variant="ghost" aria-label="Close quick expense">
                <X className="h-5 w-5" aria-hidden="true" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="quick-expense-amount" className="form-label">
                Amount (MAD)
              </label>
              <Input
                id="quick-expense-amount"
                name="amountInput"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="22"
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                aria-invalid={Boolean(fieldErrors.amountInput)}
                aria-describedby={fieldErrors.amountInput ? "quick-expense-amount-error" : undefined}
              />
              {fieldErrors.amountInput ? (
                <p id="quick-expense-amount-error" role="alert" className="text-[length:var(--text-meta)] text-[color:var(--ega-danger)]">
                  {fieldErrors.amountInput}
                </p>
              ) : null}
            </div>

            <fieldset disabled={isSubmitting}>
              <legend className="form-label">Category</legend>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {EXPENSE_CATEGORY_OPTIONS.filter((option) =>
                  (QUICK_CATEGORIES as readonly string[]).includes(option),
                ).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={category === option}
                    onClick={() => setCategory(option as QuickCategory)}
                    className="min-h-11 rounded-full border px-4 text-[length:var(--text-body)]"
                    data-active={category === option || undefined}
                  >
                    {humanize(option)}
                  </button>
                ))}
              </div>
              {fieldErrors.category ? (
                <p role="alert" className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-danger)]">
                  {fieldErrors.category}
                </p>
              ) : null}
            </fieldset>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="quick-expense-need" className="form-label">
                  Need or want
                </label>
                <select
                  id="quick-expense-need"
                  name="needVsWant"
                  value={needVsWant}
                  onChange={(event) => setNeedVsWant(event.target.value)}
                  className="input-instrument"
                >
                  {EXPENSE_NEED_VS_WANT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {humanize(option)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="quick-expense-payment" className="form-label">
                  Payment (optional)
                </label>
                <select
                  id="quick-expense-payment"
                  name="paymentMethod"
                  value={paymentMethod}
                  onChange={(event) => setPaymentMethod(event.target.value)}
                  className="input-instrument"
                >
                  <option value="">Not recorded</option>
                  {EXPENSE_PAYMENT_METHOD_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {humanize(option)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="quick-expense-merchant" className="form-label">
                Merchant (optional)
              </label>
              <Input
                id="quick-expense-merchant"
                name="merchant"
                type="text"
                maxLength={120}
                value={merchant}
                onChange={(event) => setMerchant(event.target.value)}
                placeholder="Café"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="quick-expense-note" className="form-label">
                Note (optional)
              </label>
              <Input
                id="quick-expense-note"
                name="note"
                type="text"
                maxLength={500}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>

            <div aria-live="polite">
              {formError ? (
                <p role="alert" className="feedback-block feedback-block-error">
                  {formError}
                </p>
              ) : null}
              {success ? (
                <p role="status" className="feedback-block feedback-block-success">
                  Expense saved. A new purchase will use a new key.
                </p>
              ) : null}
            </div>

            <div className="flex gap-2">
              <Button type="submit" className="min-h-11" disabled={isSubmitting || success}>
                {isSubmitting ? "Saving…" : success ? "Saved" : "Save expense"}
              </Button>
              {success ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-11"
                  onClick={() => {
                    setSuccess(false);
                    setAmountInput("");
                    document.getElementById("quick-expense-amount")?.focus();
                  }}
                >
                  Another purchase
                </Button>
              ) : null}
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
