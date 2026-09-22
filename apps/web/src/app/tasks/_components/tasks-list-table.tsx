import { TaskCardActions } from "@/components/tasks/task-card-actions";
import { FocusPinToggleForm } from "@/components/tasks/focus-pin-toggle-form";
import { TaskDueDateLabel } from "@/components/tasks/task-due-date-label";
import { TaskReminderPanel } from "@/components/tasks/task-reminder-panel";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatTaskDueDate, getTaskDueDateState } from "@/lib/task-due-date";
import { formatTaskEstimate } from "@/lib/task-estimate";
import { isTaskArchived } from "@/lib/task-archive";
import { formatTaskToken } from "@/lib/task-domain";
import { formatDurationLabel } from "@/lib/task-session";
import type { TaskRecord } from "@/lib/services/task-service";

export type TaskListActions = {
  updateAction: (formData: FormData) => void | Promise<void>;
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
  actions: TaskListActions;
};

/**
 * Dense task inventory.
 *
 * One `<table className="data-table">` serves both layouts. At phone widths
 * (<=760px) the table, head, and body become blocks and the row reproduces the
 * shared `.task-row` grammar (flex column, 10px gap, 12px/14px padding, divider
 * border) with structural utilities; the Task/Actions cells drop their boxes
 * (`display: contents`) so their children become the row's flex items. Above
 * 760px the row returns to native table layout, with `.row-main`/`.row-title`
 * carrying the task cell typography.
 *
 * Reproducing the grammar here instead of applying `.task-row` directly keeps
 * the desktop row free of the shared class's padding/border, which Chromium
 * applies to `display: table-row` elements and which would need `!important`
 * overrides to undo.
 *
 * Keeping a single render preserves the `#task-<id>` anchor and mounts exactly
 * one progressive-disclosure editor per task at every width.
 */
export function TasksListTable({
  tasks,
  taskTotalDurations,
  returnTo,
  taskUpdateTaskId,
  taskUpdateError,
  actions,
}: TasksListTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table table-fixed max-[761px]:block min-[761px]:min-w-[51rem] min-[761px]:leading-none">
        <thead className="max-[761px]:hidden">
          <tr>
            <th scope="col">Task</th>
            <th scope="col" className="w-[5rem]">
              Project
            </th>
            <th scope="col" className="w-[5rem]">
              Goal
            </th>
            <th scope="col" className="w-[6rem]">
              Priority
            </th>
            <th scope="col" className="w-[9.5rem]">
              Due
            </th>
            <th scope="col" className="w-[4rem] text-right">
              Est.
            </th>
            <th scope="col" className="w-[6.5rem]">
              Status
            </th>
            <th scope="col" className="w-[7.5rem] text-right">
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
  overdue: "text-[color:var(--status-overdue)]",
  today: "text-[color:var(--status-info)]",
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
    >
      {formatTaskDueDate(dueDate)}
      {stateLabel ? <span>· {stateLabel}</span> : null}
    </span>
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
  const isPinned = task.focus_rank !== null;
  const projectName = task.projects?.name ?? null;
  const goalTitle = task.goals?.title ?? null;
  const estimateLabel = task.estimate_minutes ? formatTaskEstimate(task.estimate_minutes) : null;
  const trackedLabel = typeof trackedSeconds === "number" ? trackedSeconds : null;

  const rowActions = (
    <TaskCardActions
      compact
      action={actions.updateAction}
      deleteAction={actions.deleteAction}
      archiveAction={actions.archiveAction}
      unarchiveAction={actions.unarchiveAction}
      startTimerAction={actions.startTimerAction}
      taskId={task.id}
      taskTitle={task.title}
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
      reminders={
        <TaskReminderPanel
          taskId={task.id}
          reminders={task.task_reminders}
          returnTo={returnTo}
          createAction={actions.createReminderAction}
          cancelAction={actions.cancelReminderAction}
        />
      }
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

  return (
    <tr
      id={`task-${task.id}`}
      className="scroll-mt-24 max-[761px]:flex max-[761px]:flex-col max-[761px]:gap-2.5 max-[761px]:border-b max-[761px]:border-[var(--ega-divider)] max-[761px]:px-3.5 max-[761px]:py-3 max-[761px]:last:border-b-0"
    >
      <td className="max-[761px]:contents">
        <div className="row-main">
          <div className="flex min-w-0 items-center gap-2">
            <span className="row-title" title={task.title}>
              {task.title}
            </span>
            {task.description ? (
              <span className="max-[761px]:hidden min-w-0 flex-1 truncate text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
                {task.description}
              </span>
            ) : null}
            {isPinned ? <Badge tone="info">Pinned #{task.focus_rank}</Badge> : null}
            {archived ? <Badge tone="muted">Archived</Badge> : null}
          </div>
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
              <StatusBadge status={task.status} />
              <Badge tone={task.priority === "urgent" || task.priority === "high" ? "warn" : "muted"}>
                {formatTaskToken(task.priority)}
              </Badge>
              {estimateLabel ? <Badge tone="muted">Est. {estimateLabel}</Badge> : null}
              {trackedLabel !== null ? (
                <Badge tone="muted">Tracked {formatDurationLabel(trackedLabel)}</Badge>
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
        <span className="block truncate text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
          {projectName ?? "—"}
        </span>
      </td>

      <td className="max-[761px]:hidden">
        <span className="block truncate text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
          {goalTitle ?? "—"}
        </span>
      </td>

      <td className="max-[761px]:hidden">
        <Badge tone={task.priority === "urgent" || task.priority === "high" ? "warn" : "muted"}>
          {formatTaskToken(task.priority)}
        </Badge>
      </td>

      <td className="max-[761px]:hidden">
        <TaskDueCell dueDate={task.due_date} status={task.status} />
      </td>

      <td className="numeric max-[761px]:hidden text-right text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
        {estimateLabel ?? "—"}
      </td>

      <td className="max-[761px]:hidden">
        <StatusBadge status={task.status} />
      </td>

      <td className="max-[761px]:contents">
        <div className="flex items-center justify-end gap-1.5 max-[761px]:justify-start">
          {rowActions}
        </div>
      </td>
    </tr>
  );
}
