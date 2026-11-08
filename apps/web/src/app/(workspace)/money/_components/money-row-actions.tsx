"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Pencil, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DeleteExpenseControl } from "@/components/money/delete-expense-control";
import { ExpenseEditForm } from "@/components/money/expense-edit-form";
import type { ExpenseDto } from "@ega/contracts/expenses";

import {
  deleteExpenseAction,
  getExpenseAction,
  updateExpenseAction,
} from "../actions";

export type MoneyRowActionsProps = {
  ownerKey: string;
  expense: ExpenseDto;
};

/**
 * Per-row edit and soft-delete controls for the Money ledger table.
 *
 * Edit runs in a dialog mounted only while open, so reopening starts from
 * freshly revalidated server data and never leaks one expense's draft into
 * another. Successful mutations refresh the server-rendered list; the edit
 * form itself preserves the draft on version conflicts for deliberate
 * reconciliation.
 */
export function MoneyRowActions({ ownerKey, expense }: MoneyRowActionsProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const label = expense.merchant ?? expense.note ?? "Expense";

  return (
    <div className="flex items-center justify-end gap-2">
      <DialogPrimitive.Root open={editOpen} onOpenChange={setEditOpen}>
        <DialogPrimitive.Trigger asChild>
          <Button
            type="button"
            size="sm"
            variant="muted"
            data-testid={`money-edit-${expense.id}`}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            Edit
          </Button>
        </DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-[var(--ega-overlay)] transition-opacity" />
          <DialogPrimitive.Content
            aria-label={`Edit expense ${label}`}
            className="fixed left-1/2 top-1/2 z-[91] flex max-h-[min(50rem,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-[53rem] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-[var(--ega-border)] bg-[var(--ega-surface)] shadow-[var(--ega-shadow-lg)] outline-none"
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--ega-border)] px-5 pb-4 pt-5 sm:px-6">
              <div className="min-w-0 space-y-1.5">
                <DialogPrimitive.Title className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)] text-[color:var(--ega-text)]">
                  Edit expense
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="min-w-0 truncate text-[length:var(--text-body)] text-[color:var(--ega-text-secondary)]">
                  {label}
                </DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 shrink-0 rounded-full p-0"
                  aria-label="Close expense editor"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DialogPrimitive.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
              {editOpen ? (
                <ExpenseEditForm
                  ownerKey={ownerKey}
                  expense={expense}
                  submitUpdate={updateExpenseAction}
                  fetchLatest={getExpenseAction}
                  onUpdated={() => {
                    setEditOpen(false);
                    router.refresh();
                  }}
                />
              ) : null}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <DeleteExpenseControl
        ownerKey={ownerKey}
        expenseId={expense.id}
        expenseLabel={label}
        deleteExpense={deleteExpenseAction}
        onDeleted={() => router.refresh()}
        triggerLabel="Delete"
        dataTestId={`money-delete-${expense.id}`}
      />
    </div>
  );
}
