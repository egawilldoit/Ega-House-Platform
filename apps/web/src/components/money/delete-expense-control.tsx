"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { Button } from "@/components/ui/button";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";

export type ExpenseDeleteResult =
  | { ok: true; alreadyDeleted: boolean }
  | { ok: false; code?: string; error: string };

export type DeleteExpenseControlProps = {
  ownerKey: string;
  expenseId: string;
  expenseLabel: string;
  deleteExpense: (id: string) => Promise<ExpenseDeleteResult>;
  /**
   * Reconcile the visible list: remove the id on success (including
   * `alreadyDeleted`) and never render it as active again.
   */
  onDeleted?: (id: string, alreadyDeleted: boolean) => void;
  triggerLabel?: string;
  dataTestId?: string;
};

/**
 * Soft-delete confirmation for one expense (PO-06B, Team B).
 *
 * Uses the existing soft-delete transport only — no hard delete, no direct
 * table mutation. Success (including idempotent `alreadyDeleted`) is reported
 * through `onDeleted` so the owning list reconciles immediately.
 */
export function DeleteExpenseControl({
  ownerKey,
  expenseId,
  expenseLabel,
  deleteExpense,
  onDeleted,
  triggerLabel = "Delete expense",
  dataTestId,
}: DeleteExpenseControlProps) {
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Owner isolation: never carry an open confirm or error across accounts.
  const [ownerScope, setOwnerScope] = useState(ownerKey);
  if (ownerScope !== ownerKey) {
    setOwnerScope(ownerKey);
    setOpen(false);
    setIsDeleting(false);
    setError(null);
  }

  async function handleConfirm() {
    if (isDeleting) return;
    setIsDeleting(true);
    setError(null);
    try {
      const result = await deleteExpense(expenseId);
      if (result.ok) {
        setOpen(false);
        onDeleted?.(expenseId, result.alreadyDeleted);
        return;
      }
      setError(result.error);
    } catch {
      setError(
        "We could not confirm whether this expense was removed. Retry safely; repeating the delete is safe.",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogPrimitive.Trigger asChild>
        <PendingSubmitButton
          type="button"
          size="sm"
          variant="danger"
          pendingLabel="Deleting…"
          data-testid={dataTestId}
        >
          {triggerLabel}
        </PendingSubmitButton>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[95] bg-[var(--ega-overlay)] transition-opacity" />
        <DialogPrimitive.Content
          aria-label={`Delete expense ${expenseLabel}`}
          className="fixed left-1/2 top-1/2 z-[96] w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--ega-border)] bg-[var(--ega-surface)] p-5 shadow-[var(--ega-shadow-lg)] outline-none"
        >
          <DialogPrimitive.Title className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)] text-[color:var(--ega-text)]">
            Delete expense
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-2 text-sm leading-5 text-[color:var(--ega-text-secondary)]">
            Remove &quot;{expenseLabel}&quot; from your active expenses? This
            archives it — it will no longer appear as active.
          </DialogPrimitive.Description>

          {error ? (
            <p role="alert" className="feedback-block feedback-block-error mt-3">
              {error}
            </p>
          ) : null}

          <div className="mt-4 flex justify-end gap-2">
            <DialogPrimitive.Close asChild>
              <Button
                type="button"
                size="sm"
                variant="muted"
                disabled={isDeleting}
                data-testid={dataTestId ? `${dataTestId}-cancel` : undefined}
              >
                Cancel
              </Button>
            </DialogPrimitive.Close>
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={isDeleting}
              aria-busy={isDeleting}
              aria-label={`Confirm delete ${expenseLabel}`}
              data-testid={dataTestId ? `${dataTestId}-confirm` : undefined}
              onClick={handleConfirm}
            >
              {isDeleting ? "Deleting…" : "Confirm"}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
