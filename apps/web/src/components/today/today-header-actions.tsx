"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Timer } from "lucide-react";

import { QuickExpenseSheet } from "@/components/money/quick-expense-sheet";
import { createExpenseAction } from "@/app/(workspace)/money/actions";
import { QUICK_TASK_EVENT } from "@/lib/workspace-events";

/**
 * Today header actions.
 *
 * Reuses the shell's single QuickTaskSheet by dispatching the canonical event,
 * so no second task form is created here. Quick expense is the canonical
 * PO-06 create action behind the amount-first sheet (PO-07).
 */
export function TodayHeaderActions({ ownerKey }: { ownerKey: string }) {
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <QuickExpenseSheet
        ownerKey={ownerKey}
        submitExpense={createExpenseAction}
        onCreated={() => router.refresh()}
      />
      <Link
        href="/timer"
        className="btn-instrument btn-instrument-muted flex h-8 items-center gap-1.5 px-3 text-sm"
      >
        <Timer className="h-4 w-4" aria-hidden="true" />
        Open timer
      </Link>
      <button
        type="button"
        className="btn-instrument flex h-8 items-center gap-1.5 px-3 text-sm"
        aria-haspopup="dialog"
        data-testid="today-add-task"
        onClick={() => window.dispatchEvent(new CustomEvent(QUICK_TASK_EVENT))}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add task
      </button>
    </div>
  );
}
