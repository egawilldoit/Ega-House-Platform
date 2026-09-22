"use client";

import Link from "next/link";
import { Plus, Timer } from "lucide-react";

import { QUICK_TASK_EVENT } from "@/lib/workspace-events";

/**
 * Today header actions.
 *
 * Reuses the shell's single QuickTaskSheet by dispatching the canonical event,
 * so no second task form is created here.
 */
export function TodayHeaderActions() {
  return (
    <div className="flex flex-wrap items-center gap-2">
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
