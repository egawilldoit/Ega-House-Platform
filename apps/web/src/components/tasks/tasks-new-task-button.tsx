"use client";

import { Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { QUICK_TASK_EVENT } from "@/lib/workspace-events";

type TasksNewTaskButtonProps = {
  label?: string;
  className?: string;
  testId?: string;
  /** Icon-only rendering for dense toolbars; the label becomes the aria-label. */
  compact?: boolean;
};

/**
 * Tasks surface "New task" trigger.
 *
 * Dispatches the canonical `QUICK_TASK_EVENT` so the shell's single
 * `QuickTaskSheet` opens; this component never mounts a second task form.
 */
export function TasksNewTaskButton({
  label = "New task",
  className,
  testId,
  compact = false,
}: TasksNewTaskButtonProps) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={compact ? label : undefined}
      data-testid={testId}
      className={cn(
        "btn-instrument h-8 shrink-0 items-center gap-1.5",
        compact ? "flex w-8 justify-center px-0" : "flex px-3 text-sm",
        className,
      )}
      onClick={() => window.dispatchEvent(new CustomEvent(QUICK_TASK_EVENT))}
    >
      <Plus className="h-4 w-4" aria-hidden="true" />
      {compact ? null : label}
    </button>
  );
}
