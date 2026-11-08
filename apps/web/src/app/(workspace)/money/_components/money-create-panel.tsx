"use client";

import { useRouter } from "next/navigation";

import { ExpenseCreateForm } from "@/components/money/expense-create-form";

import { createExpenseAction } from "../actions";

/**
 * Authenticated expense creation section for the Money page.
 *
 * Server action is passed directly (Next server reference); persistence is
 * confirmed by the action before any success handling, and the server
 * component list revalidates via `revalidatePath("/money")` plus an explicit
 * client refresh. `ownerKey` scopes the draft and idempotency key to the
 * verified owner.
 */
export function MoneyCreatePanel({ ownerKey }: { ownerKey: string }) {
  const router = useRouter();

  return (
    <section
      aria-labelledby="money-add-heading"
      className="mt-6 rounded-lg border border-ega-border p-5"
    >
      <h2
        id="money-add-heading"
        className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]"
      >
        Add expense
      </h2>
      <div className="mt-4">
        <ExpenseCreateForm
          ownerKey={ownerKey}
          submitExpense={createExpenseAction}
          onCreated={() => router.refresh()}
        />
      </div>
    </section>
  );
}
