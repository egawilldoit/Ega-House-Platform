import React from "react";
import { Clock3, Folder, ListChecks, Pin } from "lucide-react";

import { FocusPinToggleForm } from "@/components/tasks/focus-pin-toggle-form";
import { TaskDueDateLabel } from "@/components/tasks/task-due-date-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  formatTaskToken,
  isTaskCompletedStatus,
  isTaskStatus,
  type TaskStatus,
} from "@/lib/task-domain";
import { formatTaskEstimate } from "@/lib/task-estimate";
import { formatDurationLabel } from "@/lib/task-session";
import type { TaskRecord } from "@/lib/services/task-service";

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
  returnTo = "/tasks?layout=kanban",
  trackedSeconds,
  error,
}: TaskKanbanCardProps) {
  const projectName = task.projects?.name?.trim();
  const goalTitle = task.goals?.title?.trim();
  const blockedReason = task.blocked_reason?.trim();
  const estimateLabel = formatTaskEstimate(task.estimate_minutes);
  const hasTrackedTime = typeof trackedSeconds === "number";
  const isArchived = task.archived_at !== null;
  const isPinned = task.focus_rank !== null;
  const isCompleted = isTaskCompletedStatus(task.status);
  const nextStatuses = getTaskKanbanNextStatuses(task.status);
  const showStatusControls = Boolean(updateAction) && canShowTaskKanbanStatusControls(task);
  const pinToggleAction = isPinned ? unpinAction : pinAction;
  const showActiveActions = !isArchived && Boolean(
    (startTimerAction && !isCompleted) ||
      pinToggleAction ||
      archiveAction ||
      deleteAction,
  );
  const showArchivedActions = isArchived && Boolean(unarchiveAction || deleteAction);

  return (
    <article
      id={`task-${task.id}`}
      className="scroll-mt-24 rounded-[0.9rem] border border-[rgba(15,23,42,0.08)] bg-[rgba(255,255,255,0.62)] p-3 shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
    >
      <div className="flex items-start gap-2.5">
        <span
          className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${signalTone}`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-[color:var(--foreground)]">
              {task.title}
            </h3>
            {isPinned ? (
              <Badge tone="info" className="shrink-0 gap-1">
                <Pin className="h-3 w-3" aria-hidden="true" />
                Pinned
              </Badge>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <StatusBadge status={task.status} />
            <Badge tone="muted">{formatTaskToken(task.priority)}</Badge>
            {isArchived ? <Badge tone="warn">Archived</Badge> : null}
          </div>

          {projectName || goalTitle ? (
            <div className="space-y-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
              {projectName ? (
                <p className="flex min-w-0 items-center gap-1.5">
                  <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{projectName}</span>
                </p>
              ) : null}
              {goalTitle ? (
                <p className="flex min-w-0 items-center gap-1.5">
                  <ListChecks className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{goalTitle}</span>
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-1.5">
            <TaskDueDateLabel dueDate={task.due_date} status={task.status} />
            {estimateLabel ? <Badge tone="muted">Est. {estimateLabel}</Badge> : null}
            {hasTrackedTime ? (
              <Badge tone="muted" className="gap-1.5">
                <Clock3 className="h-3 w-3" aria-hidden="true" />
                Tracked {formatDurationLabel(trackedSeconds)}
              </Badge>
            ) : null}
          </div>

          {task.status === "blocked" && blockedReason ? (
            <p className="rounded-[0.8rem] border border-[rgba(220,38,38,0.18)] bg-[rgba(220,38,38,0.06)] px-2.5 py-2 text-xs leading-5 text-[var(--signal-error)]">
              Blocked: {blockedReason}
            </p>
          ) : null}

          {showStatusControls ? (
            <div className="border-t border-[rgba(15,23,42,0.08)] pt-2">
              <p className="glass-label text-etch">Move</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
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
            <div className="border-t border-[rgba(15,23,42,0.08)] pt-2">
              <p className="glass-label text-etch">Actions</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {startTimerAction && !isCompleted ? (
                  <form action={startTimerAction}>
                    <TaskKanbanActionHiddenFields taskId={task.id} returnTo={returnTo} />
                    <Button type="submit" size="sm" variant="ghost">
                      Start timer
                    </Button>
                  </form>
                ) : null}

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
            <div className="border-t border-[rgba(15,23,42,0.08)] pt-2">
              <p className="glass-label text-etch">Archived actions</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
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
      {blockedReasonValue !== undefined ? (
        <input type="hidden" name="blockedReason" value={blockedReasonValue} />
      ) : null}
    </>
  );
}
