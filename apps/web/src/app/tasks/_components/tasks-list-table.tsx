"use client";

import { TaskCardActions } from "@/components/tasks/task-card-actions";
import type { UpdateTaskEditorAction } from "@/components/tasks/edit-task-modal";
import { FocusPinToggleForm } from "@/components/tasks/focus-pin-toggle-form";
import { TaskDueDateLabel } from "@/components/tasks/task-due-date-label";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { useTaskEditorOpenState } from "@/components/tasks/use-task-editor-open-state";
import { getTaskDueDateState } from "@/lib/task-due-date";
import { isTaskArchived } from "@/lib/task-archive";
import { isTaskCompletedStatus } from "@/lib/task-domain";
import {
  formatDisplayDate,
  formatDisplayDuration,
  formatDisplayEstimate,
  formatDisplayStatus,
  formatDisplayToken,
} from "@/lib/presentation-format";
import type { TaskRecord } from "@/lib/services/task-service";

export type TaskListActions = {
  updateAction: (formData: FormData) => void | Promise<void>;
  updateEditorAction: UpdateTaskEditorAction;
  deleteAction: (formData: FormData) => void | Promise<void>;
  archiveAction: (formData: FormData) => void | Promise<void>;
  unarchiveAction: (formData: FormData) => void | Promise<void>;
  startTimerAction: (formData: FormData) => void | Promise<void>;
  pinAction: (formData: FormData) => void | Promise<void>;
  unpinAction: (formData: FormData) => void | Promise<void>;
  createReminderAction: (formData: FormData) => void | Promise<void>;
  cancelReminderAction: (formData: FormData) => void | Promise<void>;
};

type TasksListTableProps = {
  tasks: TaskRecord[];
  taskTotalDurations: Record<string, number>;
  returnTo: string;
  taskUpdateTaskId: string | null;
  taskUpdateError: string | null;
  density?: "comfortable" | "compact";
  actions: TaskListActions;
};

/**
 * Dense task inventory with the task as the scanning anchor.
 *
 * Desktop IA is TASK | PRIORITY | DUE | STATUS | ACTIONS. The Task cell carries
 * the primary title (clicking it opens the shared `EditTaskModal` through the
 * row's controlled editor state) and a muted `Project · Goal` context line, so
 * the dedicated Project/Goal columns are gone. Every row still keeps the
 * `#task-<id>` anchor and mounts exactly one progressive editor.
 *
 * Density is a per-render class: `--density-compact` trims cell padding to
 * ~44–50px rows via the shared `.data-table` grammar; comfortable stays at the
 * ~58–64px default. Phone widths (<=760px) collapse to stacked `task-row` boxes
 * as before, with project/goal carried in the phone metadata block.
 */
export function TasksListTable({
  tasks,
  taskTotalDurations,
  returnTo,
  taskUpdateTaskId,
  taskUpdateError,
  density = "comfortable",
  actions,
}: TasksListTableProps) {
  return (
    <div className={`overflow-x-auto${density === "compact" ? " data-table--density-compact" : ""}`}>
      <table className="data-table table-fixed max-[761px]:block min-[761px]:w-full min-[761px]:min-w-[40rem] [&_td]:px-2 [&_th]:px-2">
        <thead className="max-[761px]:hidden">
          <tr>
            <th scope="col">Task</th>
            <th scope="col" className="w-[10%]">
              Priority
            </th>
            <th scope="col" className="w-[12%]">
              Due
            </th>
            <th scope="col" className="w-[13%]">
              Status
            </th>
            <th scope="col" className="w-[8%] text-right">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="max-[761px]:block">
          {tasks.map((task) => (
            <TaskListRow
              key={task.id}
              task={task}
              trackedSeconds={taskTotalDurations[task.id]}
              returnTo={returnTo}
              inlineError={taskUpdateTaskId === task.id ? taskUpdateError : null}
              actions={actions}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const DUE_STATE_CLASS: Record<ReturnType<typeof getTaskDueDateState>, string> = {
  overdue: "text-[color:var(--status-overdue)] font-medium",
  today: "text-[color:var(--status-info)] font-medium",
  soon: "text-[color:var(--ega-text)]",
  scheduled: "text-[color:var(--ega-text-secondary)]",
  none: "text-[color:var(--ega-text-secondary)]",
};

const DUE_STATE_LABEL: Record<ReturnType<typeof getTaskDueDateState>, string | null> = {
  overdue: "Overdue",
  today: "Due today",
  soon: "Due soon",
  scheduled: null,
  none: null,
};

const PRIORITY_TEXT_CLASS: Record<string, string> = {
  urgent: "text-[color:var(--priority-high)] font-medium",
  high: "text-[color:var(--priority-high)]",
  medium: "text-[color:var(--priority-medium)]",
  low: "text-[color:var(--ega-text-tertiary)]",
};

function TaskPriorityCell({ priority }: { priority: string }) {
  return (
    <span
      className={`text-[length:var(--text-meta-lg)] ${PRIORITY_TEXT_CLASS[priority] ?? "text-[color:var(--ega-text-tertiary)]"}`}
    >
      {formatDisplayToken(priority)}
    </span>
  );
}

function TaskDueCell({ dueDate, status }: { dueDate: string | null; status: string }) {
  if (!dueDate) {
    return (
      <span className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-tertiary)]">—</span>
    );
  }

  const dueState = getTaskDueDateState(dueDate, status);
  const stateLabel = DUE_STATE_LABEL[dueState];

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[length:var(--text-meta)] tabular-nums ${DUE_STATE_CLASS[dueState]}`}
      title={formatDisplayDate(dueDate, "detail")}
    >
      {formatDisplayDate(dueDate, "compact")}
      {stateLabel ? <span>· {stateLabel}</span> : null}
    </span>
  );
}

function TaskContextLine({
  projectName,
  goalTitle,
}: {
  projectName: string | null;
  goalTitle: string | null;
}) {
  if (!projectName && !goalTitle) {
    return null;
  }

  const projectPart = projectName ? (
    <span className="min-w-0 max-w-[20ch] truncate" title={projectName}>
      {projectName}
    </span>
  ) : null;
  const separator =
    projectName && goalTitle ? (
      <span className="shrink-0 text-[color:var(--ega-text-tertiary)]" aria-hidden="true">
        ·
      </span>
    ) : null;
  const goalPart = goalTitle ? (
    <span className="min-w-0 truncate" title={goalTitle}>
      {goalTitle}
    </span>
  ) : null;

  return (
    <div
      className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]"
      data-testid="task-context-line"
    >
      {projectPart}
      {separator}
      {goalPart}
    </div>
  );
}

function TaskListRow({
  task,
  trackedSeconds,
  returnTo,
  inlineError,
  actions,
}: {
  task: TaskRecord;
  trackedSeconds?: number;
  returnTo: string;
  inlineError: string | null;
  actions: TaskListActions;
}) {
  const archived = isTaskArchived(task.archived_at);
  const done = isTaskCompletedStatus(task.status);
  const isPinned = task.focus_rank !== null;
  const projectName = task.projects?.name ?? null;
  const goalTitle = task.goals?.title ?? null;
  const estimateLabel = task.estimate_minutes
    ? formatDisplayEstimate(task.estimate_minutes)
    : null;
  const trackedLabel = typeof trackedSeconds === "number" ? trackedSeconds : null;

  // The row owns the (error-aware) editor state so a title click drives the
  // same `EditTaskModal` the ••• control mounts — no duplicate editor.
  const { open, handleOpenChange } = useTaskEditorOpenState({
    taskId: task.id,
    error: inlineError,
  });

  const rowActions = (
    <TaskCardActions
      compact
      open={open}
      onOpenChange={handleOpenChange}
      action={actions.updateAction}
      updateEditorAction={actions.updateEditorAction}
      deleteAction={actions.deleteAction}
      archiveAction={actions.archiveAction}
      unarchiveAction={actions.unarchiveAction}
      startTimerAction={actions.startTimerAction}
      createReminderAction={actions.createReminderAction}
      cancelReminderAction={actions.cancelReminderAction}
      taskReminders={task.task_reminders}
      taskId={task.id}
      taskTitle={task.title}
      taskDescription={task.description}
      projectName={task.projects?.name ?? null}
      goalTitle={task.goals?.title ?? null}
      returnTo={returnTo}
      defaultStatus={task.status}
      defaultPriority={task.priority}
      defaultDueDate={task.due_date}
      defaultEstimateMinutes={task.estimate_minutes}
      defaultScheduledStartAt={task.scheduled_start_at}
      defaultScheduledEndAt={task.scheduled_end_at}
      defaultCalendarSyncEnabled={task.calendar_sync_enabled}
      defaultCalendarReminderMinutes={task.calendar_reminder_minutes}
      defaultBlockedReason={task.blocked_reason}
      defaultRecurrenceRule={task.task_recurrences[0]?.rule ?? null}
      archivedAt={task.archived_at}
      error={inlineError}
      overflowActions={
        !archived ? (
          <FocusPinToggleForm
            action={isPinned ? actions.unpinAction : actions.pinAction}
            taskId={task.id}
            returnTo={returnTo}
            isPinned={isPinned}
            className="w-full"
            fullWidth
          />
        ) : null
      }
    />
  );

  const titleButton = (
    <button
      type="button"
      className="task-row-title-btn"
      title={task.title}
      aria-haspopup="dialog"
      aria-label={`Edit ${task.title}`}
      data-testid={`task-title-edit-${task.id}`}
      onClick={() => handleOpenChange(true)}
    >
      {task.title}
    </button>
  );

  return (
    <tr
      id={`task-${task.id}`}
      data-row-done={done || undefined}
      data-row-archived={archived || undefined}
      className="scroll-mt-24 max-[761px]:flex max-[761px]:flex-col max-[761px]:gap-2.5 max-[761px]:border-b max-[761px]:border-[var(--ega-divider)] max-[761px]:px-3.5 max-[761px]:py-3 max-[761px]:last:border-b-0"
    >
      <td className="max-[761px]:contents">
        <div className="row-main">
          <div className="flex min-w-0 items-center gap-2">
            {titleButton}
            {task.description ? (
              <span className="max-[761px]:hidden min-w-0 flex-1 truncate text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
                {task.description}
              </span>
            ) : null}
            {estimateLabel ? (
              <Badge tone="muted" className="max-[761px]:hidden shrink-0">
                Est. {estimateLabel}
              </Badge>
            ) : null}
            {isPinned ? <Badge tone="info">Pinned #{task.focus_rank}</Badge> : null}
            {archived ? <Badge tone="muted">Archived</Badge> : null}
          </div>

          <TaskContextLine projectName={projectName} goalTitle={goalTitle} />

          {task.description ? (
            <span className="line-clamp-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)] min-[761px]:hidden">
              {task.description}
            </span>
          ) : null}
          <div
            className="mt-1.5 flex flex-col gap-1.5 min-[761px]:hidden"
            data-testid={`task-phone-meta-${task.id}`}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={task.status} label={formatDisplayStatus(task.status)} />
              <Badge tone={task.priority === "urgent" || task.priority === "high" ? "warn" : "muted"}>
                {formatDisplayToken(task.priority)}
              </Badge>
              {estimateLabel ? <Badge tone="muted">Est. {estimateLabel}</Badge> : null}
              {trackedLabel !== null ? (
                <Badge tone="muted">Tracked {formatDisplayDuration(trackedLabel, "second")}</Badge>
              ) : null}
              <TaskDueDateLabel dueDate={task.due_date} status={task.status} />
            </div>
            {task.status === "blocked" && task.blocked_reason?.trim() ? (
              <p className="line-clamp-2 rounded-[var(--radius-xs)] border border-[var(--status-overdue-border)] bg-[var(--status-overdue-bg)] px-2 py-1 text-[length:var(--text-meta)] text-[color:var(--status-overdue)]">
                Blocked: {task.blocked_reason.trim()}
              </p>
            ) : null}
          </div>
        </div>
      </td>

      <td className="max-[761px]:hidden">
        <TaskPriorityCell priority={task.priority} />
      </td>

      <td className="max-[761px]:hidden">
        <TaskDueCell dueDate={task.due_date} status={task.status} />
      </td>

      <td className="max-[761px]:hidden">
        <StatusBadge status={task.status} label={formatDisplayStatus(task.status)} />
      </td>

      <td className="max-[761px]:contents">
        <div className="flex items-center justify-end gap-1.5 max-[761px]:justify-start">
          {rowActions}
        </div>
      </td>
    </tr>
  );
}
