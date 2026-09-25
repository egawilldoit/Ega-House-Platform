"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Archive as ArchiveIcon, ArchiveRestore as UnarchiveIcon, MoreHorizontal, Play, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
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
  /**
   * Dense rendering for table/board rows: the same forms and wiring with
   * icon-only controls that carry explicit aria-labels. Default rendering is
   * unchanged for every other surface.
   */
  compact?: boolean;
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
  compact = false,
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
    <div
      className={
        compact
          ? "flex flex-wrap items-center gap-1.5 max-[761px]:gap-2"
          : "flex flex-wrap items-center gap-2"
      }
    >
      {!isArchived && !isCompleted ? (
        <form action={startTimerAction}>
          <input type="hidden" name="taskId" value={inlineProps.taskId} />
          <input type="hidden" name="returnTo" value={inlineProps.returnTo} />
          <PendingSubmitButton
            type="submit"
            size="sm"
            variant="muted"
            aria-label={compact ? `Start timer for ${inlineProps.taskTitle}` : undefined}
            className={compact ? "h-7 w-7 !px-0 max-[761px]:h-10 max-[761px]:w-10" : undefined}
            data-testid={compact ? `task-start-timer-${inlineProps.taskId}` : undefined}
            pendingLabel="Starting…"
          >
            {compact ? (
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              "Start timer"
            )}
          </PendingSubmitButton>
        </form>
      ) : null}

      {!isCompleted ? (
        <TaskMarkDoneForm
          action={inlineProps.action}
          taskId={inlineProps.taskId}
          taskTitle={inlineProps.taskTitle}
          returnTo={inlineProps.returnTo}
          defaultPriority={inlineProps.defaultPriority}
          defaultDueDate={inlineProps.defaultDueDate}
          defaultScheduledStartAt={inlineProps.defaultScheduledStartAt}
          defaultScheduledEndAt={inlineProps.defaultScheduledEndAt}
          defaultCalendarSyncEnabled={inlineProps.defaultCalendarSyncEnabled}
          defaultCalendarReminderMinutes={inlineProps.defaultCalendarReminderMinutes}
          defaultEstimateMinutes={inlineProps.defaultEstimateMinutes}
          compact={compact}
        />
      ) : null}

      {!isArchived && isCompleted && inlineProps.archiveAction ? (
        <form action={inlineProps.archiveAction}>
          <input type="hidden" name="taskId" value={inlineProps.taskId} />
          <input type="hidden" name="returnTo" value={inlineProps.returnTo} />
          <PendingSubmitButton
            type="submit"
            size="sm"
            variant="muted"
            aria-label="Archive task"
            data-testid={`task-archive-${inlineProps.taskId}`}
            className={compact ? "h-7 w-7 !px-0 max-[761px]:h-10 max-[761px]:w-10" : undefined}
            pendingLabel="Archiving…"
          >
            {compact ? (
              <ArchiveIcon className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              "Archive"
            )}
          </PendingSubmitButton>
        </form>
      ) : null}

      {isArchived && inlineProps.unarchiveAction ? (
        <form action={inlineProps.unarchiveAction}>
          <input type="hidden" name="taskId" value={inlineProps.taskId} />
          <input type="hidden" name="returnTo" value={inlineProps.returnTo} />
          <PendingSubmitButton
            type="submit"
            size="sm"
            variant="muted"
            aria-label="Restore task"
            data-testid={`task-restore-${inlineProps.taskId}`}
            className={compact ? "h-7 w-7 !px-0 max-[761px]:h-10 max-[761px]:w-10" : undefined}
            pendingLabel="Restoring…"
          >
            {compact ? (
              <UnarchiveIcon className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              "Restore"
            )}
          </PendingSubmitButton>
        </form>
      ) : null}

      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="muted"
            aria-label={`More options for ${inlineProps.taskTitle}`}
            data-testid={`task-more-options-${inlineProps.taskId}`}
            className={compact ? "h-7 w-7 !px-0 max-[761px]:h-10 max-[761px]:w-10" : undefined}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            {compact ? null : "More options"}
          </Button>
        </SheetTrigger>

        <SheetContent
          closeLabel="Close task options"
          aria-label={`Advanced task settings for ${inlineProps.taskTitle}`}
          className="flex h-fit max-h-[min(50rem,calc(100dvh-2rem))] flex-col min-[761px]:w-[calc(100%-var(--sidebar-width))]"
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--ega-border)] px-5 pb-4 pt-5 sm:px-6">
            <SheetHeader className="min-w-0">
              <p className="glass-label">Task settings</p>
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

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
            {reminders ? (
              <section className="space-y-3">
                <p className="glass-label text-etch">Reminder</p>
                {reminders}
              </section>
            ) : null}
            <InlineTaskUpdateForm {...inlineProps} stickyFooter />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
