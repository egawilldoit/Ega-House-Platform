"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Check, RotateCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PriorityIcon } from "@/components/ui/priority-icon";
import { StatusIcon } from "@/components/ui/status-icon";
import { TaskDueDateLabel } from "@/components/tasks/task-due-date-label";
import { buildTaskDrawerLink } from "@/lib/task-drawer-url";
import type { BulkTaskResult } from "@/lib/services/task-bulk-service";
import type { TaskRecord } from "@/lib/services/task-service";
import {
  TASK_PRIORITY_VALUES,
  formatTaskToken,
  isTaskCompletedStatus,
  isTaskStatus,
  type TaskPriority,
} from "@/lib/task-domain";

type TaskListBulkActions = {
  bulkFieldAction: (input: {
    taskIds: string[];
    field: string;
    value: string;
    returnTo?: string;
  }) => Promise<BulkTaskResult>;
  bulkArchiveAction: (input: {
    taskIds: string[];
    archived: boolean;
    returnTo?: string;
  }) => Promise<BulkTaskResult>;
};

type TaskListProps = {
  tasks: TaskRecord[];
  returnTo: string;
  view: "active" | "archived";
  bulkActions: TaskListBulkActions;
  unarchiveAction?: (formData: FormData) => void | Promise<void>;
  taskUpdateTaskId?: string | null;
  taskUpdateError?: string | null;
};

function isPriority(value: string): value is TaskPriority {
  return (TASK_PRIORITY_VALUES as readonly string[]).includes(value);
}

function summarize(result: BulkTaskResult) {
  const failed = result.results.filter((entry) => entry.outcome !== "applied").length;
  const base =
    result.applied === 1 ? "1 task updated." : `${result.applied} tasks updated.`;
  return failed > 0 ? `${base} ${failed} could not be updated.` : base;
}

/**
 * Lean, semantic task list.
 *
 * The row is the unit of work: a status checkbox completes it, the title link
 * opens the canonical drawer, and an explicit selection supports bulk Complete
 * and Archive/Restore. Arrow keys move between rows; Enter opens the drawer and
 * Space toggles selection, so the list is fully keyboard operable without a
 * grid or inline-editing machinery.
 */
export function TaskList({
  tasks,
  returnTo,
  view,
  bulkActions,
  unarchiveAction,
  taskUpdateTaskId = null,
  taskUpdateError = null,
}: TaskListProps) {
  const router = useRouter();
  const listRef = useRef<HTMLUListElement | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const visibleIds = tasks.map((task) => task.id);
  const selectedVisibleIds = selectedIds.filter((id) => visibleIds.includes(id));
  const allSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));

  const toggle = useCallback((id: string) => {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    );
  }, []);

  const runBulk = useCallback(
    (operation: () => Promise<BulkTaskResult>, clearAfter = true) => {
      setMessage(null);
      startTransition(async () => {
        const result = await operation();
        setMessage(result.errorMessage ?? summarize(result));
        if (result.applied > 0) {
          if (clearAfter) setSelectedIds([]);
          router.refresh();
        }
      });
    },
    [router],
  );

  const toggleComplete = useCallback(
    (task: TaskRecord) => {
      const completed = isTaskCompletedStatus(task.status);
      runBulk(
        () =>
          bulkActions.bulkFieldAction({
            taskIds: [task.id],
            field: "status",
            value: completed ? "todo" : "done",
            returnTo,
          }),
        false,
      );
    },
    [bulkActions, returnTo, runBulk],
  );

  const runCompleteSelected = useCallback(() => {
    const targets = tasks.filter(
      (task) =>
        selectedVisibleIds.includes(task.id) &&
        !isTaskCompletedStatus(task.status),
    );
    if (targets.length === 0) return;
    runBulk(() =>
      bulkActions.bulkFieldAction({
        taskIds: targets.map((task) => task.id),
        field: "status",
        value: "done",
        returnTo,
      }),
    );
  }, [bulkActions, returnTo, runBulk, selectedVisibleIds, tasks]);

  const runArchiveSelected = useCallback(() => {
    const archived = view === "archived";
    runBulk(() =>
      bulkActions.bulkArchiveAction({
        taskIds: selectedVisibleIds,
        archived: !archived,
        returnTo,
      }),
    );
  }, [bulkActions, returnTo, runBulk, selectedVisibleIds, view]);

  const focusRow = (index: number) => {
    const rows = listRef.current?.querySelectorAll<HTMLElement>("[data-task-row]");
    rows?.[index]?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    const target = event.target as HTMLElement;
    const editable =
      target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(target.tagName);
    if (editable) return;

    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-task-row]") ?? [],
    );
    const index = rows.indexOf(target);
    if (index === -1) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusRow(Math.min(index + 1, rows.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusRow(Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusRow(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusRow(rows.length - 1);
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      const task = tasks[index];
      if (task) toggle(task.id);
      return;
    }
    if (event.key === "Enter") {
      const task = tasks[index];
      if (task) {
        event.preventDefault();
        router.push(buildTaskDrawerLink(returnTo, task.id), { scroll: false });
      }
    }
  };

  const anyCompleteTarget = tasks.some(
    (task) =>
      selectedVisibleIds.includes(task.id) &&
      !isTaskCompletedStatus(task.status),
  );

  return (
    <div data-testid="task-list">
      {selectedVisibleIds.length > 0 ? (
        <div
          role="region"
          aria-label="Bulk task actions"
          className="flex flex-wrap items-center gap-2 border-b border-[var(--ega-divider)] bg-[var(--ega-surface-subtle)] px-[18px] py-2"
        >
          <button
            type="button"
            onClick={() => setSelectedIds(allSelected ? [] : visibleIds)}
            className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)] underline-offset-2 hover:underline"
          >
            {allSelected ? "Clear selection" : "Select all"}
          </button>
          <span
            role="status"
            className="text-[length:var(--text-meta)] font-medium text-[color:var(--ega-text)]"
          >
            {selectedVisibleIds.length} selected
          </span>

          {view === "active" ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isPending || !anyCompleteTarget}
              onClick={runCompleteSelected}
              className="h-7 px-2 text-xs"
            >
              <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Complete
            </Button>
          ) : null}

          <Button
            type="button"
            variant={view === "archived" ? "secondary" : "danger"}
            size="sm"
            disabled={isPending}
            onClick={runArchiveSelected}
            className="h-7 px-2 text-xs"
          >
            {view === "archived" ? (
              <ArchiveRestore className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Archive className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            )}
            {view === "archived" ? "Restore" : "Archive"}
          </Button>

          <button
            type="button"
            onClick={() => setSelectedIds([])}
            className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)] underline-offset-2 hover:underline"
          >
            Clear
          </button>

          {message ? (
            <span
              role="status"
              className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]"
            >
              {message}
            </span>
          ) : null}
        </div>
      ) : null}

      <ul
        ref={listRef}
        aria-label="Tasks"
        className="divide-y divide-[var(--ega-divider)]"
        onKeyDown={handleKeyDown}
      >
        {tasks.map((task, index) => {
          const completed = isTaskCompletedStatus(task.status);
          const selected = selectedIds.includes(task.id);
          const drawerHref = buildTaskDrawerLink(returnTo, task.id);
          const priority = isPriority(task.priority) ? task.priority : "medium";
          const rowError =
            taskUpdateTaskId === task.id ? taskUpdateError : null;

          return (
            <li
              key={task.id}
              id={`task-${task.id}`}
              data-task-row
              data-row-done={completed || undefined}
              data-selected={selected || undefined}
              tabIndex={0}
              className="group flex scroll-mt-24 flex-wrap items-center gap-x-3 gap-y-1.5 px-[18px] py-2.5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ega-focus-outline)] hover:bg-[var(--ega-surface-hover)] max-[761px]:items-start"
              onClick={(event) => {
                if (event.defaultPrevented || event.button !== 0) return;
                const target = event.target as HTMLElement;
                if (
                  target.closest(
                    "input,button,a,label,select,textarea,summary",
                  )
                ) {
                  return;
                }
                router.push(drawerHref, { scroll: false });
              }}
            >
              <input
                type="checkbox"
                checked={completed}
                disabled={isPending}
                onChange={() => toggleComplete(task)}
                aria-label={
                  completed
                    ? `Mark ${task.title} not complete`
                    : `Mark ${task.title} complete`
                }
                className="h-4 w-4 shrink-0"
                data-testid={`task-status-${task.id}`}
              />
              <input
                type="checkbox"
                checked={selected}
                onChange={() => toggle(task.id)}
                aria-label={`Select ${task.title}`}
                className="h-4 w-4 shrink-0 opacity-60"
              />

              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Link
                    href={drawerHref}
                    scroll={false}
                    className={`min-w-0 truncate text-sm font-medium hover:underline ${
                      completed
                        ? "text-[color:var(--ega-text-tertiary)] line-through"
                        : "text-[color:var(--ega-text)]"
                    }`}
                    title={task.title}
                    aria-label={`Open ${task.title} details`}
                    data-testid={`task-title-open-${task.id}`}
                  >
                    {task.title}
                  </Link>
                  <Badge tone="muted">
                    {task.projects?.name ?? "No project"}
                  </Badge>
                  {view === "archived" ? <Badge tone="muted">Archived</Badge> : null}
                </div>
                {task.description ? (
                  <p className="line-clamp-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
                    {task.description}
                  </p>
                ) : null}
                {rowError ? (
                  <p role="alert" className="text-[length:var(--text-meta)] text-[color:var(--status-overdue)]">
                    {rowError}
                  </p>
                ) : null}
              </div>

              <span className="flex items-center gap-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                <StatusIcon
                  status={isTaskStatus(task.status) ? task.status : "todo"}
                  decorative
                />
                {task.due_date ? (
                  <TaskDueDateLabel dueDate={task.due_date} status={task.status} />
                ) : (
                  <span className="text-[color:var(--ega-text-tertiary)]">
                    No due date
                  </span>
                )}
              </span>

              <span
                className="flex w-20 shrink-0 items-center justify-end gap-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]"
                title={`${formatTaskToken(priority)} priority`}
              >
                <PriorityIcon priority={priority} decorative />
                {formatTaskToken(priority)}
              </span>

              {view === "archived" && unarchiveAction ? (
                <form action={unarchiveAction} className="flex shrink-0">
                  <input type="hidden" name="taskId" value={task.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <Button
                    type="submit"
                    variant="secondary"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    aria-label={`Restore ${task.title}`}
                    data-testid={`task-restore-${task.id}`}
                  >
                    <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    Restore
                  </Button>
                </form>
              ) : null}

              <span className="sr-only">Row {index + 1}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
