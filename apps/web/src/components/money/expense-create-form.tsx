"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  EXPENSE_CATEGORY_OPTIONS,
  EXPENSE_NEED_VS_WANT_OPTIONS,
  EXPENSE_PAYMENT_METHOD_OPTIONS,
  validateExpenseFormValues,
  type ExpenseFormFieldErrors,
  type ValidatedExpenseFormValues,
} from "@/lib/money/expense-form-validation";
import type { ExpenseDto } from "@ega/contracts/expenses";

import { useStableIdempotencyKey } from "./use-stable-expense-key";
import { useExpenseRequestScope } from "./use-expense-request-scope";

export type ExpenseCreateSubmitInput = ValidatedExpenseFormValues & {
  idempotencyKey: string;
};

export type ExpenseCreateSubmitResult =
  | { ok: true; expense: ExpenseDto; replayed: boolean }
  | { ok: false; code?: string; error: string };

export type ExpenseCreateFormProps = {
  /**
   * Server-verified owner id. Draft text and the idempotency key are scoped
   * to this owner and reset on change so rows/drafts never leak between
   * accounts after a switch or sign-out/in.
   */
  ownerKey: string;
  defaultOccurredAtInput?: string;
  submitExpense: (
    input: ExpenseCreateSubmitInput,
  ) => Promise<ExpenseCreateSubmitResult>;
  onCreated?: (expense: ExpenseDto, replayed: boolean) => void;
};

const FIELD_LABEL = "form-label";

/**
 * Self-contained, accessible expense creation form (PO-06B, Team B).
 *
 * No routing, navigation or list coupling: Team A composes this form into the
 * Money page and passes the server-wired `submitExpense`. Double-submit is
 * prevented locally (pending guard + disabled controls) and the stable
 * idempotency key makes timeout/retry safe. Success is reported only after
 * the server confirms persistence.
 */
export function ExpenseCreateForm({
  ownerKey,
  defaultOccurredAtInput = "",
  submitExpense,
  onCreated,
}: ExpenseCreateFormProps) {
  const captureRequestScope = useExpenseRequestScope(ownerKey);
  const [idempotencyKey, rotateKey] = useStableIdempotencyKey({
    ownerKey,
    purchaseNonce: "default",
  });
  const [amountInput, setAmountInput] = useState("");
  const [occurredAtInput, setOccurredAtInput] = useState(
    defaultOccurredAtInput,
  );
  const [category, setCategory] = useState("");
  const [needVsWant, setNeedVsWant] = useState("");
  const [merchant, setMerchant] = useState("");
  const [note, setNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ExpenseFormFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ replayed: boolean } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const formErrorRef = useRef<HTMLParagraphElement | null>(null);

  // Owner isolation: a different verified owner starts with a clean draft.
  // Adjusted during render (QuickTaskSheetPanel pattern) so no state update
  // runs inside an effect; the idempotency key rotates in
  // useStableIdempotencyKey on the same owner change. The ref mirror is
  // synced in an event/effect context only, never during render.
  const [ownerScope, setOwnerScope] = useState(ownerKey);
  if (ownerScope !== ownerKey) {
    setOwnerScope(ownerKey);
    setAmountInput("");
    setOccurredAtInput(defaultOccurredAtInput);
    setCategory("");
    setNeedVsWant("");
    setMerchant("");
    setNote("");
    setPaymentMethod("");
    setFieldErrors({});
    setFormError(null);
    setSuccess(null);
    setIsSubmitting(false);
  }
  useEffect(() => {
    submittingRef.current = isSubmitting;
  }, [isSubmitting, ownerScope]);

  useEffect(() => {
    if (formError) formErrorRef.current?.focus();
  }, [formError]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    // Double-submit prevention: ignore re-entrant submits while pending.
    // The same idempotency key is reused for deliberate retries below.
    if (submittingRef.current) return;

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
      setFieldErrors(validation.fieldErrors);
      setFormError("Fix the highlighted fields before saving.");
      return;
    }
    setFieldErrors({});
    setFormError(null);
    submittingRef.current = true;
    setIsSubmitting(true);
    const isCurrent = captureRequestScope();
    try {
      const result = await submitExpense({
        ...validation.value,
        idempotencyKey,
      });
      if (!isCurrent()) return;
      if (result.ok) {
        setSuccess({ replayed: result.replayed });
        onCreated?.(result.expense, result.replayed);
        return;
      }
      // Failure keeps the draft and the SAME key so an explicit retry is an
      // idempotent replay, never a duplicate purchase.
      setFormError(result.error);
    } catch {
      if (!isCurrent()) return;
      setFormError("Unable to save the expense right now. Retry — no duplicate will be created.");
    } finally {
      if (isCurrent()) {
        submittingRef.current = false;
        setIsSubmitting(false);
      }
    }
  }

  function handleNewPurchase() {
    rotateKey();
    setAmountInput("");
    setOccurredAtInput(defaultOccurredAtInput);
    setCategory("");
    setNeedVsWant("");
    setMerchant("");
    setNote("");
    setPaymentMethod("");
    setFieldErrors({});
    setFormError(null);
    setSuccess(null);
  }

  const amountErrorId = "expense-create-amount-error";
  const occurredAtErrorId = "expense-create-occurred-at-error";

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Add expense"
      className="flex flex-col gap-4"
      noValidate
    >
      <div className="space-y-2">
        <label htmlFor="expense-create-amount" className={FIELD_LABEL}>
          Amount (MAD)
        </label>
        <Input
          id="expense-create-amount"
          name="amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="22.50"
          required
          value={amountInput}
          onChange={(event) => setAmountInput(event.target.value)}
          aria-invalid={Boolean(fieldErrors.amountInput)}
          aria-describedby={fieldErrors.amountInput ? amountErrorId : undefined}
          disabled={isSubmitting || success !== null}
          className="h-11 w-full"
        />
        {fieldErrors.amountInput ? (
          <p id={amountErrorId} role="alert" className="text-sm text-[var(--signal-error)]">
            {fieldErrors.amountInput}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="expense-create-occurred-at" className={FIELD_LABEL}>
            Date and time
          </label>
          <Input
            id="expense-create-occurred-at"
            name="occurredAt"
            type="datetime-local"
            required
            value={occurredAtInput}
            onChange={(event) => setOccurredAtInput(event.target.value)}
            aria-invalid={Boolean(fieldErrors.occurredAtInput)}
            aria-describedby={fieldErrors.occurredAtInput ? occurredAtErrorId : undefined}
            disabled={isSubmitting || success !== null}
            className="h-11 w-full"
          />
          {fieldErrors.occurredAtInput ? (
            <p id={occurredAtErrorId} role="alert" className="text-sm text-[var(--signal-error)]">
              {fieldErrors.occurredAtInput}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <label htmlFor="expense-create-category" className={FIELD_LABEL}>
            Category
          </label>
          <select
            id="expense-create-category"
            name="category"
            required
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            disabled={isSubmitting || success !== null}
            className="input-instrument h-11 w-full text-sm"
          >
            <option value="">Select a category</option>
            {EXPENSE_CATEGORY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          {fieldErrors.category ? (
            <p role="alert" className="text-sm text-[var(--signal-error)]">
              {fieldErrors.category}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <label htmlFor="expense-create-need" className={FIELD_LABEL}>
            Need or want
          </label>
          <select
            id="expense-create-need"
            name="needVsWant"
            required
            value={needVsWant}
            onChange={(event) => setNeedVsWant(event.target.value)}
            disabled={isSubmitting || success !== null}
            className="input-instrument h-11 w-full text-sm"
          >
            <option value="">Select need or want</option>
            {EXPENSE_NEED_VS_WANT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          {fieldErrors.needVsWant ? (
            <p role="alert" className="text-sm text-[var(--signal-error)]">
              {fieldErrors.needVsWant}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <label htmlFor="expense-create-payment" className={FIELD_LABEL}>
            Payment method <span className="font-normal">(optional)</span>
          </label>
          <select
            id="expense-create-payment"
            name="paymentMethod"
            value={paymentMethod}
            onChange={(event) => setPaymentMethod(event.target.value)}
            disabled={isSubmitting || success !== null}
            className="input-instrument h-11 w-full text-sm"
          >
            <option value="">No payment method</option>
            {EXPENSE_PAYMENT_METHOD_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          {fieldErrors.paymentMethod ? (
            <p role="alert" className="text-sm text-[var(--signal-error)]">
              {fieldErrors.paymentMethod}
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="expense-create-merchant" className={FIELD_LABEL}>
          Merchant <span className="font-normal">(optional)</span>
        </label>
        <Input
          id="expense-create-merchant"
          name="merchant"
          autoComplete="off"
          value={merchant}
          onChange={(event) => setMerchant(event.target.value)}
          disabled={isSubmitting || success !== null}
          className="h-11 w-full"
        />
        {fieldErrors.merchant ? (
          <p role="alert" className="text-sm text-[var(--signal-error)]">
            {fieldErrors.merchant}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label htmlFor="expense-create-note" className={FIELD_LABEL}>
          Note <span className="font-normal">(optional)</span>
        </label>
        <Textarea
          id="expense-create-note"
          name="note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          disabled={isSubmitting || success !== null}
          placeholder="Optional note for this purchase."
          className="min-h-20 w-full resize-none"
        />
        {fieldErrors.note ? (
          <p role="alert" className="text-sm text-[var(--signal-error)]">
            {fieldErrors.note}
          </p>
        ) : null}
      </div>

      {success ? (
        <p role="status" aria-live="polite" className="feedback-block">
          {success.replayed
            ? "This purchase was already saved. The retry confirmed the existing expense; no duplicate was created."
            : "Expense saved successfully."} Choose “New purchase” to enter another expense.
        </p>
      ) : null}

      {formError ? (
        <p
          ref={formErrorRef}
          role="alert"
          tabIndex={-1}
          className="feedback-block feedback-block-error"
        >
          {formError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={isSubmitting || success !== null}
          aria-busy={isSubmitting}
          data-testid="expense-create-submit"
        >
          {isSubmitting ? "Saving…" : success ? "Saved" : "Add expense"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="md"
          onClick={handleNewPurchase}
          disabled={isSubmitting}
        >
          New purchase
        </Button>
      </div>
      <p className="text-xs leading-5 text-[color:var(--muted-foreground)]">
        Retrying after a timeout reuses the same purchase key — it cannot
        create a duplicate. Use “New purchase” only for a genuinely new
        expense.
      </p>
    </form>
  );
}
