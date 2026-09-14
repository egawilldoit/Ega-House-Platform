"use client";

import { useEffect, useState, type ReactNode } from "react";
import { MoreHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { isTaskCompletedStatus } from "@/lib/task-domain";

import { InlineTaskUpdateForm, TaskMarkDoneForm } from "./inline-task-update-form";

type TaskCardActionsProps = {
  action: (formData: FormData) => void | Promise<void>;
  deleteAction: (formData: FormData) => void | Promise<void>;
  archiveAction?: (formData: FormData) => void | Promise<void>;
  unarchiveAction?: (formData: FormData) => void | Promise<void>;
  startTimerAction: (formData: FormData) => void | Promise<void>;
  taskId: string;
  taskTitle: string;
  returnTo: string;
  defaultStatus: string;
  defaultPriority: string;
  defaultDueDate: string | null;
  defaultEstimateMinutes: number | null;
  defaultScheduledStartAt: string | null;
  defaultScheduledEndAt: string | null;
  defaultCalendarSyncEnabled: boolean;
  defaultCalendarReminderMinutes: number;
  defaultBlockedReason: string | null;
  defaultRecurrenceRule?: string | null;
  archivedAt?: string | null;
  error?: string | null;
  overflowActions?: ReactNode;
  reminders?: ReactNode;
};

/**
 * Minimal list-card action row plus the progressive-disclosure advanced editor.
 *
 * The card keeps its primary execution actions visible and moves the existing
 * `InlineTaskUpdateForm` into a Sheet. Opening/closing the Sheet performs no
 * mutation; the form inside still submits through the canonical server actions.
 */
export function TaskCardActions({
  startTimerAction,
  reminders,
  ...inlineProps
}: TaskCardActionsProps) {
  const [manualOpen, setManualOpen] = useState(false);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const isArchived = Boolean(inlineProps.archivedAt);
  const isCompleted = isTaskCompletedStatus(inlineProps.defaultStatus);

  const errorMessage = inlineProps.error ?? null;
  // A failed save redirects back with an error for this exact task. The error
  // lives inside the advanced editor, so that task's editor opens automatically
  // (initial render and later error transitions) until the user dismisses it.
  const open =
    manualOpen || (Boolean(errorMessage) && errorMessage !== dismissedError);

  useEffect(() => {
    if (!open || !errorMessage) return;
    document.getElementById(`task-update-error-${inlineProps.taskId}`)?.focus();
  }, [open, errorMessage, inlineProps.taskId]);

  function handleOpenChange(nextOpen: boolean) {
    setManualOpen(nextOpen);
    if (!nextOpen) setDismissedError(errorMessage);
  }

  return (
    <div className="tasks-card-actions flex flex-wrap items-center gap-2">
      {!isArchived && !isCompleted ? (
        <form action={startTimerAction}>
          <input type="hidden" name="taskId" value={inlineProps.taskId} />
          <input type="hidden" name="returnTo" value={inlineProps.returnTo} />
          <Button type="submit" size="sm" variant="muted">
            Start timer
          </Button>
        </form>
      ) : null}

      {!isCompleted ? (
        <TaskMarkDoneForm
          action={inlineProps.action}
          taskId={inlineProps.taskId}
          returnTo={inlineProps.returnTo}
          defaultPriority={inlineProps.defaultPriority}
          defaultDueDate={inlineProps.defaultDueDate}
          defaultScheduledStartAt={inlineProps.defaultScheduledStartAt}
          defaultScheduledEndAt={inlineProps.defaultScheduledEndAt}
          defaultCalendarSyncEnabled={inlineProps.defaultCalendarSyncEnabled}
          defaultCalendarReminderMinutes={inlineProps.defaultCalendarReminderMinutes}
          defaultEstimateMinutes={inlineProps.defaultEstimateMinutes}
        />
      ) : null}

      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="muted"
            aria-label={`More options for ${inlineProps.taskTitle}`}
            data-testid={`task-more-options-${inlineProps.taskId}`}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            More options
          </Button>
        </SheetTrigger>

        <SheetContent
          aria-label={`Advanced task settings for ${inlineProps.taskTitle}`}
          className="flex flex-col"
        >
          <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 pb-4 pt-5 sm:px-6">
            <SheetHeader className="min-w-0">
              <p className="glass-label text-signal-live">Task settings</p>
              <SheetTitle>Advanced settings</SheetTitle>
              <SheetDescription>{inlineProps.taskTitle}</SheetDescription>
            </SheetHeader>
            <SheetClose asChild>
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 h-9 w-9 shrink-0 rounded-full p-0"
                aria-label="Close advanced task settings"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </SheetClose>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
            {reminders}
            <InlineTaskUpdateForm {...inlineProps} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
