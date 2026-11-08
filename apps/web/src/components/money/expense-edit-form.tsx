"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatMinorToMadInput } from "@/lib/money/money-amount";
import {
  EXPENSE_CATEGORY_OPTIONS,
  EXPENSE_NEED_VS_WANT_OPTIONS,
  EXPENSE_PAYMENT_METHOD_OPTIONS,
  validateExpenseFormValues,
  type ExpenseFormFieldErrors,
} from "@/lib/money/expense-form-validation";
import type { ExpenseDto } from "@ega/contracts/expenses";

export type ExpenseEditSubmitResult =
  | { ok: true; expense: ExpenseDto }
  | { ok: false; code?: string; error: string };

export type ExpenseEditFormProps = {
  /** Server-verified owner id; draft resets on change (no cross-owner leak). */
  ownerKey: string;
  expense: ExpenseDto;
  /** Persist the patch with the given expected version. */
  submitUpdate: (
    id: string,
    patch: {
      version: number;
      occurredAt?: string;
      amountMinor?: number;
      category?: ExpenseDto["category"];
      needVsWant?: ExpenseDto["needVsWant"];
      merchant?: string | null;
      note?: string | null;
      paymentMethod?: ExpenseDto["paymentMethod"] | null;
    },
  ) => Promise<ExpenseEditSubmitResult>;
  /** Reload the server row for deliberate reconciliation after a conflict. */
  fetchLatest: (id: string) => Promise<{ ok: true; expense: ExpenseDto } | { ok: false; error: string }>;
  onUpdated?: (expense: ExpenseDto) => void;
};

const FIELD_LABEL = "form-label";

function toDatetimeLocalValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/**
 * Self-contained expense editor with optimistic-concurrency safety
 * (PO-06B, Team B).
 *
 * The unsaved draft is preserved on 409 CONFLICT; the form stays usable and
 * offers an explicit refresh/retry path. It never silently overwrites newer
 * server state and never auto-retries with a bumped version.
 */
export function ExpenseEditForm({
  ownerKey,
  expense,
  submitUpdate,
  fetchLatest,
  onUpdated,
}: ExpenseEditFormProps) {
  const [amountInput, setAmountInput] = useState(() =>
    formatMinorToMadInput(expense.amountMinor),
  );
  const [occurredAtInput, setOccurredAtInput] = useState(() =>
    toDatetimeLocalValue(expense.occurredAt),
  );
  const [category, setCategory] = useState<string>(expense.category);
  const [needVsWant, setNeedVsWant] = useState<string>(expense.needVsWant);
  const [merchant, setMerchant] = useState(expense.merchant ?? "");
  const [note, setNote] = useState(expense.note ?? "");
  const [paymentMethod, setPaymentMethod] = useState<string>(expense.paymentMethod ?? "");
  const [baseVersion, setBaseVersion] = useState(expense.version);
  const [fieldErrors, setFieldErrors] = useState<ExpenseFormFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{
    serverVersion: number;
    serverUpdatedAt: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const formErrorRef = useRef<HTMLParagraphElement | HTMLDivElement | null>(null);

  // Draft ownership: a different expense or owner remounts the draft.
  // Adjusted during render so background refreshes never overwrite typed
  // input through an effect.
  const [draftScope, setDraftScope] = useState(`${expense.id}::${ownerKey}`);
  const scope = `${expense.id}::${ownerKey}`;
  if (draftScope !== scope) {
    setDraftScope(scope);
    setAmountInput(formatMinorToMadInput(expense.amountMinor));
    setOccurredAtInput(toDatetimeLocalValue(expense.occurredAt));
    setCategory(expense.category);
    setNeedVsWant(expense.needVsWant);
    setMerchant(expense.merchant ?? "");
    setNote(expense.note ?? "");
    setPaymentMethod(expense.paymentMethod ?? "");
    setBaseVersion(expense.version);
    setFieldErrors({});
    setFormError(null);
    setConflict(null);
    setIsSubmitting(false);
  }
  useEffect(() => {
    submittingRef.current = isSubmitting;
  }, [isSubmitting, draftScope]);

  useEffect(() => {
    if (formError || conflict) formErrorRef.current?.focus();
  }, [formError, conflict]);

  async function persist(version: number): Promise<boolean> {
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
      return false;
    }
    setFieldErrors({});
    setFormError(null);
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const result = await submitUpdate(expense.id, {
        version,
        occurredAt: validation.value.occurredAt,
        amountMinor: validation.value.amountMinor,
        category: validation.value.category,
        needVsWant: validation.value.needVsWant,
        merchant: validation.value.merchant,
        note: validation.value.note,
        paymentMethod: validation.value.paymentMethod,
      });
      if (result.ok) {
        setBaseVersion(result.expense.version);
        setConflict(null);
        onUpdated?.(result.expense);
        return true;
      }
      if (result.code === "CONFLICT") {
        // Preserve the draft; require deliberate reconciliation.
        setConflict((current) =>
          current ?? {
            serverVersion: baseVersion + 1,
            serverUpdatedAt: new Date().toISOString(),
          },
        );
        setFormError(
          "This expense changed elsewhere. Your edits are preserved — refresh to compare, then retry deliberately.",
        );
        return false;
      }
      setFormError(result.error);
      return false;
    } catch {
      setFormError("Unable to save right now. Your edits are preserved — retry when ready.");
      return false;
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submittingRef.current) return;
    await persist(conflict ? conflict.serverVersion : baseVersion);
  }

  async function handleRefresh() {
    const latest = await fetchLatest(expense.id);
    if (!latest.ok) {
      setFormError(latest.error);
      return;
    }
    // Deliberate reconciliation only: adopt the new version as the base for
    // the next explicit save, but keep every typed field untouched.
    setBaseVersion(latest.expense.version);
    setConflict({
      serverVersion: latest.expense.version,
      serverUpdatedAt: latest.expense.updatedAt,
    });
    setFormError(
      "Loaded the latest saved version. Review your preserved edits, then save to apply them.",
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label={`Edit expense ${expense.id}`}
      className="flex flex-col gap-4"
      noValidate
    >
      <div className="space-y-2">
        <label htmlFor={`expense-edit-amount-${expense.id}`} className={FIELD_LABEL}>
          Amount (MAD)
        </label>
        <Input
          id={`expense-edit-amount-${expense.id}`}
          inputMode="decimal"
          autoComplete="off"
          required
          value={amountInput}
          onChange={(event) => setAmountInput(event.target.value)}
          aria-invalid={Boolean(fieldErrors.amountInput)}
          disabled={isSubmitting}
          className="h-11 w-full"
        />
        {fieldErrors.amountInput ? (
          <p role="alert" className="text-sm text-[var(--signal-error)]">
            {fieldErrors.amountInput}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor={`expense-edit-occurred-${expense.id}`} className={FIELD_LABEL}>
            Date and time
          </label>
          <Input
            id={`expense-edit-occurred-${expense.id}`}
            type="datetime-local"
            required
            value={occurredAtInput}
            onChange={(event) => setOccurredAtInput(event.target.value)}
            disabled={isSubmitting}
            className="h-11 w-full"
          />
          {fieldErrors.occurredAtInput ? (
            <p role="alert" className="text-sm text-[var(--signal-error)]">
              {fieldErrors.occurredAtInput}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <label htmlFor={`expense-edit-category-${expense.id}`} className={FIELD_LABEL}>
            Category
          </label>
          <select
            id={`expense-edit-category-${expense.id}`}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            disabled={isSubmitting}
            className="input-instrument h-11 w-full text-sm"
          >
            {EXPENSE_CATEGORY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label htmlFor={`expense-edit-need-${expense.id}`} className={FIELD_LABEL}>
            Need or want
          </label>
          <select
            id={`expense-edit-need-${expense.id}`}
            value={needVsWant}
            onChange={(event) => setNeedVsWant(event.target.value)}
            disabled={isSubmitting}
            className="input-instrument h-11 w-full text-sm"
          >
            {EXPENSE_NEED_VS_WANT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label htmlFor={`expense-edit-payment-${expense.id}`} className={FIELD_LABEL}>
            Payment method
          </label>
          <select
            id={`expense-edit-payment-${expense.id}`}
            value={paymentMethod}
            onChange={(event) => setPaymentMethod(event.target.value)}
            disabled={isSubmitting}
            className="input-instrument h-11 w-full text-sm"
          >
            <option value="">No payment method</option>
            {EXPENSE_PAYMENT_METHOD_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor={`expense-edit-merchant-${expense.id}`} className={FIELD_LABEL}>
          Merchant <span className="font-normal">(optional)</span>
        </label>
        <Input
          id={`expense-edit-merchant-${expense.id}`}
          autoComplete="off"
          value={merchant}
          onChange={(event) => setMerchant(event.target.value)}
          disabled={isSubmitting}
          className="h-11 w-full"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor={`expense-edit-note-${expense.id}`} className={FIELD_LABEL}>
          Note <span className="font-normal">(optional)</span>
        </label>
        <Textarea
          id={`expense-edit-note-${expense.id}`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          disabled={isSubmitting}
          className="min-h-20 w-full resize-none"
        />
      </div>

      {conflict ? (
        <div
          role="alert"
          ref={formErrorRef}
          tabIndex={-1}
          className="feedback-block feedback-block-error flex-col items-stretch gap-2"
        >
          <p>
            Version conflict: the saved expense is now at version{" "}
            {conflict.serverVersion}. Your edits above are preserved.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="muted"
              size="sm"
              onClick={handleRefresh}
              disabled={isSubmitting}
              data-testid={`expense-edit-refresh-${expense.id}`}
            >
              Refresh latest
            </Button>
          </div>
        </div>
      ) : null}

      {formError && !conflict ? (
        <p
          ref={formErrorRef}
          role="alert"
          tabIndex={-1}
          className="feedback-block feedback-block-error"
        >
          {formError}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          data-testid={`expense-edit-save-${expense.id}`}
        >
          {isSubmitting ? "Saving…" : conflict ? "Retry with latest version" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
