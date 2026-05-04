import React from "react";
import { ChevronDown, Clock3, Folder, Pin } from "lucide-react";

import { FocusPinToggleForm } from "@/components/tasks/focus-pin-toggle-form";
import { TaskDueDateLabel } from "@/components/tasks/task-due-date-label";
import { TaskReminderPanel } from "@/components/tasks/task-reminder-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatTaskEstimate } from "@/lib/task-estimate";
import {
  formatTaskToken,
  isTaskCompletedStatus,
  isTaskStatus,
  type TaskStatus,
} from "@/lib/task-domain";
import { formatTaskDueDate } from "@/lib/task-due-date";
import type { TaskRecord } from "@/lib/services/task-service";
import { formatTaskRecurrenceRule } from "@/lib/task-recurrence";
import { formatDurationLabel } from "@/lib/task-session";
import { cn } from "@/lib/utils";

type TaskKanbanCardProps = {
  task: TaskRecord;
  signalTone: string;
  updateAction?: (formData: FormData) => void | Promise<void>;
  startTimerAction?: (formData: FormData) => void | Promise<void>;
  pinAction?: (formData: FormData) => void | Promise<void>;
  unpinAction?: (formData: FormData) => void | Promise<void>;
  archiveAction?: (formData: FormData) => void | Promise<void>;
  unarchiveAction?: (formData: FormData) => void | Promise<void>;
  deleteAction?: (formData: FormData) => void | Promise<void>;
  createReminderAction?: (formData: FormData) => void | Promise<void>;
  cancelReminderAction?: (formData: FormData) => void | Promise<void>;
  returnTo?: string;
  trackedSeconds?: number;
  error?: string | null;
};

const NEXT_STATUS_BY_STATUS = {
  todo: ["in_progress", "blocked", "done"],
  in_progress: ["todo", "blocked", "done"],
  blocked: ["todo", "in_progress", "done"],
  done: ["todo"],
} as const satisfies Record<TaskStatus, readonly TaskStatus[]>;

export function getTaskKanbanNextStatuses(status: string): TaskStatus[] {
  return isTaskStatus(status) ? [...NEXT_STATUS_BY_STATUS[status]] : [];
}

export function getTaskKanbanStatusActionLabel(status: TaskStatus) {
  if (status === "todo") {
    return "Todo";
  }

  if (status === "in_progress") {
    return "In Progress";
  }

  if (status === "blocked") {
    return "Block";
  }

  return "Done";
}

export function canShowTaskKanbanStatusControls(task: Pick<TaskRecord, "archived_at" | "status">) {
  return task.archived_at === null && getTaskKanbanNextStatuses(task.status).length > 0;
}

export function TaskKanbanCard({
  task,
  signalTone,
  updateAction,
  startTimerAction,
  pinAction,
  unpinAction,
  archiveAction,
  unarchiveAction,
  deleteAction,
  createReminderAction,
  cancelReminderAction,
  returnTo = "/tasks?layout=kanban",
  trackedSeconds,
  error,
}: TaskKanbanCardProps) {
  const projectName = task.projects?.name?.trim();
  const goalName = task.goals?.title?.trim();
  const isArchived = task.archived_at !== null;
  const isPinned = task.focus_rank !== null;
  const isCompleted = isTaskCompletedStatus(task.status);
  const isBlocked = task.status === "blocked";
  const estimateLabel = formatTaskEstimate(task.estimate_minutes);
  const trackedLabel = typeof trackedSeconds === "number" ? formatDurationLabel(trackedSeconds) : null;
  const recurrenceRule = task.task_recurrences[0]?.rule ?? null;
  const recurrenceLabel = recurrenceRule ? formatTaskRecurrenceRule(recurrenceRule) : null;
  const nextStatuses = getTaskKanbanNextStatuses(task.status);
  const showStatusControls = Boolean(updateAction) && canShowTaskKanbanStatusControls(task);
  const pinToggleAction = isPinned ? unpinAction : pinAction;
  const showTimerAction = !isArchived && !isCompleted && Boolean(startTimerAction);
  const showActiveActions = !isArchived && Boolean(pinToggleAction || archiveAction || deleteAction);
  const showArchivedActions = isArchived && Boolean(unarchiveAction || deleteAction);
  const showOverflowActions = showStatusControls || showActiveActions || showArchivedActions;
  const showReminderPanel = Boolean(createReminderAction && cancelReminderAction);
  const showDetails = Boolean(
    goalName ||
      estimateLabel ||
      trackedLabel ||
      recurrenceLabel ||
      task.blocked_reason ||
      showReminderPanel ||
      showOverflowActions,
  );

  return (
    <article
      id={`task-${task.id}`}
      className={cn(
        "scroll-mt-24 rounded-[0.9rem] border bg-[rgba(255,255,255,0.62)] p-2.5 shadow-[0_10px_24px_rgba(15,23,42,0.05)] sm:p-3",
        isBlocked
          ? "border-[rgba(198,40,40,0.28)] bg-[rgba(198,40,40,0.05)]"
          : "border-[rgba(15,23,42,0.08)]",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${signalTone}`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-[color:var(--foreground)]">
                {task.title}
              </h3>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
                {projectName ? (
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{projectName}</span>
                  </span>
                ) : null}
                <TaskKanbanCompactDateLabel
                  dueDate={task.due_date}
                  plannedForDate={task.planned_for_date}
                />
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {isPinned ? (
                <Badge tone="info" className="gap-1">
                  <Pin className="h-3 w-3" aria-hidden="true" />
                  Pinned
                </Badge>
              ) : null}
              {showTimerAction ? (
                <form action={startTimerAction}>
                  <TaskKanbanActionHiddenFields taskId={task.id} returnTo={returnTo} />
                  <Button type="submit" size="sm" variant="default" className="gap-1.5 px-2.5">
                    <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                    Start timer
                  </Button>
                </form>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Badge tone="muted">{formatTaskToken(task.priority)}</Badge>
            <StatusBadge status={task.status} />
            {isBlocked ? <Badge tone="warn">Blocked</Badge> : null}
            {recurrenceLabel ? <Badge tone="info">{recurrenceLabel}</Badge> : null}
            {isArchived ? <Badge tone="warn">Archived</Badge> : null}
          </div>

          {isBlocked && task.blocked_reason ? (
            <p className="line-clamp-2 rounded-[0.75rem] border border-[rgba(198,40,40,0.16)] bg-[rgba(198,40,40,0.05)] px-2 py-1.5 text-xs leading-5 text-[var(--signal-error)]">
              Blocked: {task.blocked_reason}
            </p>
          ) : null}

          {showDetails ? (
            <details className="group border-t border-[rgba(15,23,42,0.08)] pt-2">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-[color:var(--muted-foreground)] transition-precise hover:text-[color:var(--foreground)]">
                Details
                <ChevronDown
                  className="h-3.5 w-3.5 transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="mt-2 space-y-3">
                {goalName || estimateLabel || trackedLabel || recurrenceLabel || task.blocked_reason ? (
                  <dl className="grid gap-2 rounded-[0.75rem] border border-[rgba(15,23,42,0.08)] bg-[rgba(255,255,255,0.46)] p-2 text-xs leading-5">
                    {goalName ? (
                      <TaskKanbanDetailItem label="Goal">{goalName}</TaskKanbanDetailItem>
                    ) : null}
                    {estimateLabel ? (
                      <TaskKanbanDetailItem label="Estimate">{estimateLabel}</TaskKanbanDetailItem>
                    ) : null}
                    {trackedLabel ? (
                      <TaskKanbanDetailItem label="Tracked">{trackedLabel}</TaskKanbanDetailItem>
                    ) : null}
                    {recurrenceLabel ? (
                      <TaskKanbanDetailItem label="Repeat">{recurrenceLabel}</TaskKanbanDetailItem>
                    ) : null}
                    {task.blocked_reason ? (
                      <TaskKanbanDetailItem label="Blocked reason">
                        {task.blocked_reason}
                      </TaskKanbanDetailItem>
                    ) : null}
                  </dl>
                ) : null}

                {createReminderAction && cancelReminderAction ? (
                  <TaskReminderPanel
                    taskId={task.id}
                    reminders={task.task_reminders}
                    returnTo={returnTo}
                    createAction={createReminderAction}
                    cancelAction={cancelReminderAction}
                    compact
                  />
                ) : null}

                {showStatusControls ? (
                  <div>
                    <p className="glass-label text-etch">Move</p>
                    <div className="tasks-kanban-card-actions mt-2 flex flex-wrap gap-1.5">
                      {nextStatuses.map((status) =>
                        status === "blocked" ? (
                          <details key={status} className="w-full rounded-[0.75rem] border border-[rgba(198,40,40,0.16)] bg-[rgba(198,40,40,0.04)] p-2">
                            <summary className="cursor-pointer text-xs font-semibold text-[var(--signal-error)]">
                              Block
                            </summary>
                            <form action={updateAction} className="mt-2 space-y-2">
                              <TaskKanbanStatusHiddenFields
                                task={task}
                                returnTo={returnTo}
                                nextStatus={status}
                              />
                              <label className="space-y-1" htmlFor={`kanban-blocked-reason-${task.id}`}>
                                <span className="glass-label text-etch">Blocked reason</span>
                                <textarea
                                  id={`kanban-blocked-reason-${task.id}`}
                                  name="blockedReason"
                                  required
                                  minLength={2}
                                  rows={3}
                                  className="input-instrument min-h-16 w-full resize-y px-2 py-2 text-xs normal-case tracking-normal"
                                  placeholder="What is blocking this?"
                                />
                              </label>
                              <button
                                type="submit"
                                className={`${buttonVariants({ size: "sm", variant: "danger" })} w-full justify-center`}
                              >
                                Save Blocked
                              </button>
                            </form>
                          </details>
                        ) : (
                          <form key={status} action={updateAction}>
                            <TaskKanbanStatusHiddenFields
                              task={task}
                              returnTo={returnTo}
                              nextStatus={status}
                              blockedReasonValue=""
                            />
                            <button
                              type="submit"
                              className={buttonVariants({ size: "sm", variant: "muted" })}
                            >
                              {task.status === "done" && status === "todo"
                                ? "Reopen"
                                : getTaskKanbanStatusActionLabel(status)}
                            </button>
                          </form>
                        ),
                      )}
                    </div>
                  </div>
                ) : null}

                {showActiveActions ? (
                  <div>
                    <p className="glass-label text-etch">Actions</p>
                    <div className="tasks-kanban-card-actions mt-2 flex flex-wrap gap-1.5">
                      {pinToggleAction ? (
                        <FocusPinToggleForm
                          action={pinToggleAction}
                          taskId={task.id}
                          returnTo={returnTo}
                          isPinned={isPinned}
                          compact
                        />
                      ) : null}

                      {archiveAction ? (
                        <form action={archiveAction}>
                          <TaskKanbanActionHiddenFields taskId={task.id} returnTo={returnTo} />
                          <Button type="submit" size="sm" variant="danger">
                            Archive
                          </Button>
                        </form>
                      ) : null}

                      {deleteAction ? (
                        <form action={deleteAction}>
                          <TaskKanbanActionHiddenFields taskId={task.id} returnTo={returnTo} />
                          <input type="hidden" name="confirmDelete" value="true" />
                          <Button type="submit" size="sm" variant="danger">
                            Delete
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {showArchivedActions ? (
                  <div>
                    <p className="glass-label text-etch">Archived actions</p>
                    <div className="tasks-kanban-card-actions mt-2 flex flex-wrap gap-1.5">
                      {unarchiveAction ? (
                        <form action={unarchiveAction}>
                          <TaskKanbanActionHiddenFields taskId={task.id} returnTo={returnTo} />
                          <Button type="submit" size="sm" variant="muted">
                            Restore
                          </Button>
                        </form>
                      ) : null}

                      {deleteAction ? (
                        <form action={deleteAction}>
                          <TaskKanbanActionHiddenFields taskId={task.id} returnTo={returnTo} />
                          <input type="hidden" name="confirmDelete" value="true" />
                          <Button type="submit" size="sm" variant="danger">
                            Delete
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}

          {error ? (
            <p className="feedback-block feedback-block-error">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function TaskKanbanCompactDateLabel({
  dueDate,
  plannedForDate,
}: {
  dueDate: string | null;
  plannedForDate: string | null;
}) {
  if (dueDate) {
    return <TaskDueDateLabel dueDate={dueDate} textClassName="text-xs leading-5" />;
  }

  if (!plannedForDate) {
    return null;
  }

  return <span>Planned {formatTaskDueDate(plannedForDate)}</span>;
}

function TaskKanbanDetailItem({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-0.5">
      <dt className="glass-label text-etch">{label}</dt>
      <dd className="text-[color:var(--foreground)]">{children}</dd>
    </div>
  );
}

function TaskKanbanActionHiddenFields({
  taskId,
  returnTo,
}: {
  taskId: string;
  returnTo: string;
}) {
  return (
    <>
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="returnTo" value={returnTo} />
    </>
  );
}

function TaskKanbanStatusHiddenFields({
  task,
  returnTo,
  nextStatus,
  blockedReasonValue,
}: {
  task: TaskRecord;
  returnTo: string;
  nextStatus: TaskStatus;
  blockedReasonValue?: string;
}) {
  return (
    <>
      <input type="hidden" name="taskId" value={task.id} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="status" value={nextStatus} />
      <input type="hidden" name="priority" value={task.priority} />
      <input type="hidden" name="dueDate" value={task.due_date ?? ""} />
      <input
        type="hidden"
        name="estimateMinutes"
        value={task.estimate_minutes !== null ? String(task.estimate_minutes) : ""}
      />
      <input type="hidden" name="recurrenceRule" value={task.task_recurrences[0]?.rule ?? ""} />
      {blockedReasonValue !== undefined ? (
        <input type="hidden" name="blockedReason" value={blockedReasonValue} />
      ) : null}
    </>
  );
}
