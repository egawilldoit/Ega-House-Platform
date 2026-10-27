"use client";

import { useEffect, useRef, useState } from "react";

import { TaskCardActions } from "@/components/tasks/task-card-actions";
import type { UpdateTaskEditorAction } from "@/components/tasks/edit-task-modal";
import { FocusPinToggleForm } from "@/components/tasks/focus-pin-toggle-form";
import { TaskDueDateLabel } from "@/components/tasks/task-due-date-label";
import Link from "next/link";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { Badge } from "@/components/ui/badge";
import { buildTaskDrawerHref } from "@/components/tasks/drawer/use-task-drawer-param";
import { StatusBadge } from "@/components/ui/status-badge";
import { useTaskEditorOpenState } from "@/components/tasks/use-task-editor-open-state";
import { getLocalDateInTimezone } from "@ega/domain/time-context";
import { useDisplayTimezone } from "@/lib/hooks/use-display-timezone";
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
import { TaskBulkBar, type TaskBulkActions } from "./task-bulk-bar";

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
  updateReminderAction: (formData: FormData) => void | Promise<void>;
  cancelReminderAction: (formData: FormData) => void | Promise<void>;
  bulkFieldAction: TaskBulkActions["bulkFieldAction"];
  bulkArchiveAction: TaskBulkActions["bulkArchiveAction"];
  undoAction: TaskBulkActions["undoAction"];
};

type TasksListTableProps = {
  tasks: TaskRecord[];
  taskTotalDurations: Record<string, number>;
  subtaskCounts?: Record<string, { done: number; total: number }>;
  returnTo: string;
  taskUpdateTaskId: string | null;
  taskUpdateError: string | null;
  projectOptions?: Array<{ id: string; name: string }>;
  goalOptions?: Array<{ id: string; title: string; projectId: string }>;
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
  subtaskCounts = {},
  returnTo,
  taskUpdateTaskId,
  taskUpdateError,
  projectOptions = [],
  goalOptions = [],
  density = "comfortable",
  actions,
}: TasksListTableProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const visibleIds = tasks.map((task) => task.id);
  const selectedVisibleIds = selectedIds.filter((id) => visibleIds.includes(id));
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const anyArchived = tasks.some(
    (task) => selectedIds.includes(task.id) && isTaskArchived(task.archived_at),
  );

  const toggle = (id: string) =>
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );

  // Ctrl/Cmd+A applies only to this rendered selection surface, never while a
  // text field owns focus; Escape clears it.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const editable =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");
      if (editable) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelectedIds(tasks.map((task) => task.id));
        return;
      }
      if (event.key === "Escape") {
        setSelectedIds([]);
      }
    };
    node.addEventListener("keydown", onKeyDown);
    return () => node.removeEventListener("keydown", onKeyDown);
  }, [tasks]);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className={`overflow-x-auto${density === "compact" ? " data-table--density-compact" : ""}`}
    >
      {selectedVisibleIds.length > 0 ? (
        <TaskBulkBar
          selectedIds={selectedVisibleIds}
          returnTo={returnTo}
          projectOptions={projectOptions}
          anyArchived={anyArchived}
          actions={actions}
          onClear={() => setSelectedIds([])}
        />
      ) : null}
      <table className="data-table table-fixed max-[761px]:block min-[761px]:w-full min-[761px]:min-w-[40rem] [&_td]:px-2 [&_th]:px-2">
        <thead className="max-[761px]:hidden">
          <tr>
            <th scope="col">
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={allVisibleSelected}
                  onChange={() =>
                    setSelectedIds(allVisibleSelected ? [] : tasks.map((task) => task.id))
                  }
                  aria-label="Select all tasks in this view"
                />
                Task
              </span>
            </th>
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
              subtaskCount={subtaskCounts[task.id] ?? null}
              returnTo={returnTo}
              inlineError={taskUpdateTaskId === task.id ? taskUpdateError : null}
              projectOptions={projectOptions}
              goalOptions={goalOptions}
              actions={actions}
              selected={selectedIds.includes(task.id)}
              onToggleSelected={() => toggle(task.id)}
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
  const todayIsoDate = getLocalDateInTimezone(new Date(), useDisplayTimezone());

  if (!dueDate) {
    return (
      <span className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-tertiary)]">—</span>
    );
  }

  const dueState = getTaskDueDateState(dueDate, status, todayIsoDate);
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
  projectOptions,
  goalOptions,
  actions,
  selected,
  onToggleSelected,
  subtaskCount,
}: {
  task: TaskRecord;
  trackedSeconds?: number;
  returnTo: string;
  inlineError: string | null;
  projectOptions: Array<{ id: string; name: string }>;
  goalOptions: Array<{ id: string; title: string; projectId: string }>;
  actions: TaskListActions;
  selected: boolean;
  onToggleSelected: () => void;
  subtaskCount?: { done: number; total: number } | null;
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
  const editorOpenerRef = useRef<HTMLElement | null>(null);

  // The row owns the (error-aware) editor state for the ••• control's
  // `EditTaskModal`; the title is a link to the drawer instead.
  const { open, handleOpenChange } = useTaskEditorOpenState({
    taskId: task.id,
    error: inlineError,
  });

  const rowActions = (
    <TaskCardActions
      compact
      open={open}
      onOpenChange={handleOpenChange}
      restoreFocusRef={editorOpenerRef}
      onEditorTriggerActivate={(element) => {
        editorOpenerRef.current = element;
      }}
      action={actions.updateAction}
      updateEditorAction={actions.updateEditorAction}
      deleteAction={actions.deleteAction}
      archiveAction={actions.archiveAction}
      unarchiveAction={actions.unarchiveAction}
      startTimerAction={actions.startTimerAction}
      createReminderAction={actions.createReminderAction}
      updateReminderAction={actions.updateReminderAction}
      cancelReminderAction={actions.cancelReminderAction}
      taskReminders={task.task_reminders}
      taskId={task.id}
      taskTitle={task.title}
      taskDescription={task.description}
      projectName={task.projects?.name ?? null}
      goalTitle={task.goals?.title ?? null}
      defaultProjectId={task.project_id}
      defaultGoalId={task.goal_id}
      projectOptions={projectOptions}
      goalOptions={goalOptions}
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

  // The title is the drawer entry point: it links to the URL-addressable detail
  // view, so middle-click/new-tab and back/forward work. Editing stays on the
  // ••• control, which owns the existing modal and its focus restoration.
  const drawerHref = (() => {
    const base = new URL(returnTo, "http://ega.local");
    return buildTaskDrawerHref(base.pathname, base.searchParams, { taskId: task.id });
  })();

  const titleLink = (
    <Link
      href={drawerHref}
      // Keep the list where the user left it: the drawer is a side panel, and
      // the stage-1 URL helpers already pass scroll:false for the same reason.
      scroll={false}
      className="task-row-title-btn"
      title={task.title}
      aria-label={`Open ${task.title} details`}
      data-testid={`task-title-open-${task.id}`}
    >
      {task.title}
    </Link>
  );

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
    <tr
      id={`task-${task.id}`}
      data-row-done={done || undefined}
      data-row-archived={archived || undefined}
      tabIndex={0}
      aria-selected={selected}
      onKeyDown={(event) => {
        // Shift+F10 / the context-menu key open the same menu as right-click.
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          event.currentTarget.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              clientX: rect.left + Math.min(rect.width / 2, 240),
              clientY: rect.top + rect.height / 2,
            }),
          );
        }
      }}
      className="scroll-mt-24 focus-visible:outline-[var(--ega-focus-outline)] focus-visible:outline-offset-[-2px] max-[761px]:flex max-[761px]:flex-col max-[761px]:gap-2.5 max-[761px]:border-b max-[761px]:border-[var(--ega-divider)] max-[761px]:px-3.5 max-[761px]:py-3 max-[761px]:last:border-b-0"
    >
      <td className="max-[761px]:contents">
        <div className="row-main">
          <div className="flex min-w-0 items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0"
              checked={selected}
              onChange={onToggleSelected}
              aria-label={`Select ${task.title}`}
            />
            {titleLink}
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
            {subtaskCount && subtaskCount.total > 0 ? (
              <Badge
                tone="muted"
                aria-label={`${subtaskCount.done} of ${subtaskCount.total} subtasks done`}
              >
                ☑ {subtaskCount.done}/{subtaskCount.total}
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
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="z-[80] min-w-[12rem] rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[var(--ega-surface)] p-1 text-sm shadow-[var(--ega-shadow-md)]"
          aria-label={`Actions for ${task.title}`}
        >
          <ContextMenu.Item asChild>
            <Link
              href={drawerHref}
              scroll={false}
              className="flex cursor-default select-none items-center rounded-[var(--radius-sm)] px-2 py-1.5 outline-none data-[highlighted]:bg-[var(--ega-surface-hover)]"
            >
              Open details
            </Link>
          </ContextMenu.Item>
          <ContextMenu.Item
            className="flex cursor-default select-none items-center rounded-[var(--radius-sm)] px-2 py-1.5 outline-none data-[highlighted]:bg-[var(--ega-surface-hover)]"
            onSelect={() => {
              const url = new URL(drawerHref, window.location.origin).toString();
              void navigator.clipboard?.writeText(url).catch(() => {
                // Clipboard may be unavailable (permissions/insecure context).
              });
            }}
          >
            Copy link
          </ContextMenu.Item>
          <ContextMenu.Item
            className="flex cursor-default select-none items-center rounded-[var(--radius-sm)] px-2 py-1.5 outline-none data-[highlighted]:bg-[var(--ega-surface-hover)]"
            onSelect={onToggleSelected}
          >
            {selected ? "Deselect" : "Select"}
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-[var(--ega-divider)]" />
          <ContextMenu.Item asChild>
            <form action={archived ? actions.unarchiveAction : actions.archiveAction}>
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <button
                type="submit"
                className="flex w-full cursor-default select-none items-center rounded-[var(--radius-sm)] px-2 py-1.5 text-left outline-none data-[highlighted]:bg-[var(--ega-surface-hover)]"
              >
                {archived ? "Restore" : "Archive"}
              </button>
            </form>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
