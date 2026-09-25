"use client";

import { type ReactNode, useRef } from "react";
import { Archive as ArchiveIcon, ArchiveRestore as UnarchiveIcon, MoreHorizontal, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { EditTaskModal, type UpdateTaskEditorAction } from "@/components/tasks/edit-task-modal";
import { useTaskEditorOpenState } from "@/components/tasks/use-task-editor-open-state";
import { isTaskCompletedStatus } from "@/lib/task-domain";
import type { TaskReminderRecord } from "@/lib/services/task-service";

import { TaskMarkDoneForm } from "./inline-task-update-form";

type TaskCardActionsProps = {
  action: (formData: FormData) => void | Promise<void>;
  updateEditorAction: UpdateTaskEditorAction;
  deleteAction: (formData: FormData) => void | Promise<void>;
  archiveAction?: (formData: FormData) => void | Promise<void>;
  unarchiveAction?: (formData: FormData) => void | Promise<void>;
  startTimerAction: (formData: FormData) => void | Promise<void>;
  createReminderAction: (formData: FormData) => void | Promise<void>;
  updateReminderAction: (formData: FormData) => void | Promise<void>;
  cancelReminderAction: (formData: FormData) => void | Promise<void>;
  taskReminders: TaskReminderRecord[];
  taskId: string;
  taskTitle: string;
  taskDescription?: string | null;
  projectName?: string | null;
  goalTitle?: string | null;
  defaultProjectId: string;
  defaultGoalId: string | null;
  projectOptions: Array<{ id: string; name: string }>;
  goalOptions: Array<{ id: string; title: string; projectId: string }>;
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
  /** Controlled open state; supplied by row surfaces whose title opens the editor. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Dense rendering for table/board rows: the same forms and wiring with
   * icon-only controls that carry explicit aria-labels. Default rendering is
   * unchanged for every other surface.
   */
  compact?: boolean;
};

/**
 * Minimal list-card action row plus the centered "Edit task" modal.
 *
 * The card keeps its primary execution actions visible and opens
 * `EditTaskModal` from the ••• control. Opening/closing the modal performs no
 * mutation; the editor still submits through the canonical server actions.
 */
export function TaskCardActions({
  startTimerAction,
  createReminderAction,
  updateReminderAction,
  cancelReminderAction,
  taskReminders,
  compact = false,
  ...inlineProps
}: TaskCardActionsProps) {
  const isArchived = Boolean(inlineProps.archivedAt);
  const isCompleted = isTaskCompletedStatus(inlineProps.defaultStatus);
  const editTriggerRef = useRef<HTMLButtonElement>(null);

  const { open, handleOpenChange } = useTaskEditorOpenState({
    taskId: inlineProps.taskId,
    error: inlineProps.error ?? null,
    open: inlineProps.open,
    onOpenChange: inlineProps.onOpenChange,
  });

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
            aria-label={`Archive ${inlineProps.taskTitle}`}
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
            aria-label={`Restore ${inlineProps.taskTitle}`}
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

      <EditTaskModal
        taskId={inlineProps.taskId}
        taskTitle={inlineProps.taskTitle}
        taskDescription={inlineProps.taskDescription ?? null}
        projectName={inlineProps.projectName ?? null}
        goalTitle={inlineProps.goalTitle ?? null}
        defaultProjectId={inlineProps.defaultProjectId}
        defaultGoalId={inlineProps.defaultGoalId}
        projectOptions={inlineProps.projectOptions}
        goalOptions={inlineProps.goalOptions}
        returnTo={inlineProps.returnTo}
        defaultStatus={inlineProps.defaultStatus}
        defaultPriority={inlineProps.defaultPriority}
        defaultDueDate={inlineProps.defaultDueDate}
        defaultEstimateMinutes={inlineProps.defaultEstimateMinutes}
        defaultScheduledStartAt={inlineProps.defaultScheduledStartAt}
        defaultScheduledEndAt={inlineProps.defaultScheduledEndAt}
        defaultCalendarSyncEnabled={inlineProps.defaultCalendarSyncEnabled}
        defaultCalendarReminderMinutes={inlineProps.defaultCalendarReminderMinutes}
        defaultRecurrenceRule={inlineProps.defaultRecurrenceRule ?? null}
        defaultBlockedReason={inlineProps.defaultBlockedReason}
        archivedAt={inlineProps.archivedAt ?? null}
        taskReminders={taskReminders}
        updateAction={inlineProps.updateEditorAction}
        createReminderAction={createReminderAction}
        updateReminderAction={updateReminderAction}
        cancelReminderAction={cancelReminderAction}
        deleteAction={inlineProps.deleteAction}
        archiveAction={inlineProps.archiveAction}
        unarchiveAction={inlineProps.unarchiveAction}
        overflowActions={inlineProps.overflowActions}
        error={inlineProps.error ?? null}
        open={open}
        onOpenChange={handleOpenChange}
        restoreFocusRef={editTriggerRef}
        trigger={
          <Button
            ref={editTriggerRef}
            type="button"
            size="sm"
            variant="muted"
            aria-label={`More options for ${inlineProps.taskTitle}`}
            data-testid={`task-more-options-${inlineProps.taskId}`}
            onClick={(event) => event.currentTarget.focus()}
            className={compact ? "h-7 w-7 !px-0 max-[761px]:h-10 max-[761px]:w-10" : undefined}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            {compact ? null : "More options"}
          </Button>
        }
      />
    </div>
  );
}
