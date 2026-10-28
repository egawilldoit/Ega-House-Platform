"use client";

import { DndContext } from "@dnd-kit/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useOptimistic,
  useSyncExternalStore,
  useRef,
  useState,
  useTransition,
  type ComponentProps,
} from "react";

import { useToastQueue } from "@/components/ui/toast-provider";
import { useUndoToast } from "@/components/ui/use-undo-toast";
import { TaskKanbanCard } from "@/components/tasks/task-kanban-card";
import type { BoardMoveResult, MoveTaskOnBoardInput } from "@/lib/services/task-board-service";
import type { BulkTaskResult } from "@/lib/services/task-bulk-service";
import type { TaskRecord } from "@/lib/services/task-service";
import {
  isTaskCompletedStatus,
  type TaskStatus,
} from "@/lib/task-domain";
import type { TaskBoardOrder } from "@/lib/task-list";
import {
  getBoardCollapsedSnapshot,
  getServerBoardCollapsedSnapshot,
  notifyBoardCollapsedChanged,
  parseCollapsedColumns,
  subscribeBoardCollapsed,
  writeCollapsedColumns,
} from "@/lib/task-board-preferences";
import { QUICK_TASK_EVENT } from "@/lib/workspace-events";
import { cn } from "@/lib/utils";

import { KanbanBlockedReasonDialog } from "./kanban-blocked-reason-dialog";
import { KanbanColumn } from "./kanban-column";
import {
  applyKanbanOptimisticMove,
  buildKanbanMoveRequest,
  useKanbanDnd,
  type KanbanMoveRequest,
  type KanbanTasksByStatus,
} from "./use-kanban-dnd";

export type KanbanCardActions = Omit<
  ComponentProps<typeof TaskKanbanCard>,
  "task" | "signalTone" | "trackedSeconds" | "subtaskCount" | "error"
>;

export type KanbanBulkActions = {
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
  undoAction: (operationId: string) => Promise<"success" | "conflict" | "failure">;
};

type KanbanBoardProps = {
  columns: ReadonlyArray<{ status: TaskStatus; label: string }>;
  tasksByStatus: KanbanTasksByStatus;
  boardOrder: TaskBoardOrder | null;
  activeView: string;
  ownerId: string | null;
  returnTo: string;
  manualHref: string;
  priorityHref: string;
  defaultOrderHref: string;
  moveAction: (
    input: MoveTaskOnBoardInput & { returnTo?: string },
  ) => Promise<BoardMoveResult>;
  bulkActions: KanbanBulkActions;
  cardProps: KanbanCardActions;
  taskTotalDurations: Record<string, number | undefined>;
  subtaskCounts: Record<string, { done: number; total: number } | undefined>;
  taskUpdateTaskId: string | null;
  taskUpdateError: string | null;
};

function getTaskSignalTone(status: string, priority: string) {
  if (status === "blocked" || priority === "urgent") return "bg-[var(--status-overdue)]";
  if (priority === "high") return "bg-[var(--status-risk)]";
  if (status === "in_progress") return "bg-[var(--status-info)]";
  return "bg-[var(--ega-text-tertiary)]";
}

function boardOrderLabel(boardOrder: TaskBoardOrder | null) {
  if (boardOrder === "manual") return "Manual order";
  if (boardOrder === "priority") return "Priority order";
  return "Current sort";
}

function summarizeBulk(result: BulkTaskResult, verb: string) {
  const failed = result.results.filter((entry) => entry.outcome !== "applied").length;
  const base =
    result.applied === 1
      ? `1 task ${verb}.`
      : `${result.applied} tasks ${verb}.`;
  return failed > 0 ? `${base} ${failed} could not be updated.` : base;
}

/**
 * Client board: drag mechanics, optimistic preview, column menu actions and the
 * non-drag alternatives live here. Durable order is always the server's; a
 * failed move is announced and the optimistic preview is discarded on refresh.
 */
export function KanbanBoard({
  columns,
  tasksByStatus,
  boardOrder,
  activeView,
  ownerId,
  returnTo,
  manualHref,
  priorityHref,
  defaultOrderHref,
  moveAction,
  bulkActions,
  cardProps,
  taskTotalDurations,
  subtaskCounts,
  taskUpdateTaskId,
  taskUpdateError,
}: KanbanBoardProps) {
  const router = useRouter();
  const { show } = useToastQueue();
  const { showUndo } = useUndoToast();
  const [isPending, startTransition] = useTransition();
  const [liveMessage, setLiveMessage] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [blockedPrompt, setBlockedPrompt] = useState<{
    request: KanbanMoveRequest;
    title: string | null;
    error: string | null;
  } | null>(null);
  const focusTaskId = useRef<string | null>(null);
  const [optimisticTasks, applyOptimistic] = useOptimistic(
    tasksByStatus,
    applyKanbanOptimisticMove,
  );

  const dragEnabled = boardOrder === "manual" && activeView === "active";
  const columnLabels = Object.fromEntries(
    columns.map((column) => [column.status, column.label]),
  ) as Record<TaskStatus, string>;

  // Restore focus to the moved card after the refreshed server tree commits.
  useEffect(() => {
    const taskId = focusTaskId.current;
    if (!taskId) return;
    const element = document.getElementById(`kanban-card-${taskId}`);
    if (element) {
      element.focus();
      focusTaskId.current = null;
    }
  }, [tasksByStatus]);

  const collapsedSnapshot = useSyncExternalStore(
    subscribeBoardCollapsed,
    () => getBoardCollapsedSnapshot(ownerId, activeView),
    getServerBoardCollapsedSnapshot,
  );
  const collapsed = parseCollapsedColumns(collapsedSnapshot);

  function findTask(taskId: string): TaskRecord | null {
    for (const status of Object.keys(tasksByStatus) as TaskStatus[]) {
      const task = tasksByStatus[status].find((entry) => entry.id === taskId);
      if (task) return task;
    }
    return null;
  }

  function nameFor(request: KanbanMoveRequest) {
    return findTask(request.taskId)?.title ?? "Task";
  }

  function submitMove(request: KanbanMoveRequest, blockedReason?: string) {
    startTransition(async () => {
      applyOptimistic({
        taskId: request.taskId,
        toStatus: request.toStatus,
        beforeTaskId: request.beforeTaskId,
        afterTaskId: request.afterTaskId,
      });

      const result = await moveAction({
        ...request,
        blockedReason: blockedReason ?? null,
        returnTo,
      });

      if (result.ok) {
        const title = nameFor(request);
        const message = `Moved ${title} to ${columnLabels[request.toStatus]}.`;
        setActionError(null);
        setLiveMessage(message);
        setBlockedPrompt(null);
        focusTaskId.current = request.taskId;
        router.refresh();
        return;
      }

      if (result.code === "blocked_reason_required") {
        setBlockedPrompt({
          request,
          title: findTask(request.taskId)?.title ?? null,
          error: null,
        });
        setLiveMessage(result.message);
        router.refresh();
        return;
      }

      setActionError(result.message);
      setLiveMessage(result.message);
      router.refresh();
    });
  }

  function requestMove(request: KanbanMoveRequest) {
    const task = findTask(request.taskId);
    if (
      request.toStatus === "blocked" &&
      !task?.blocked_reason?.trim()
    ) {
      setBlockedPrompt({
        request,
        title: task?.title ?? null,
        error: null,
      });
      return;
    }
    submitMove(request);
  }

  const dnd = useKanbanDnd({
    tasksByStatus,
    columnLabels,
    enabled: dragEnabled,
    onMove: requestMove,
  });

  function moveByStep(taskId: string, direction: "up" | "down") {
    const status = Object.keys(tasksByStatus).find((key) =>
      tasksByStatus[key as TaskStatus].some((task) => task.id === taskId),
    ) as TaskStatus | undefined;
    if (!status) return;
    const tasks = tasksByStatus[status];
    const index = tasks.findIndex((task) => task.id === taskId);
    if (index === -1) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= tasks.length) return;
    const request = buildKanbanMoveRequest(tasksByStatus, taskId, {
      status,
      index: targetIndex,
    });
    if (request) requestMove(request);
  }

  function moveToStatus(taskId: string, toStatus: TaskStatus) {
    const request = buildKanbanMoveRequest(tasksByStatus, taskId, {
      status: toStatus,
      index: tasksByStatus[toStatus].filter((task) => task.id !== taskId).length,
    });
    if (request) requestMove(request);
  }

  function toggleCollapse(status: string) {
    const next = collapsed.includes(status)
      ? collapsed.filter((value) => value !== status)
      : [...collapsed, status];
    writeCollapsedColumns(window.localStorage, ownerId, activeView, next);
    notifyBoardCollapsedChanged();
  }

  function addTask(status: TaskStatus) {
    window.dispatchEvent(
      new CustomEvent(QUICK_TASK_EVENT, { detail: { status } }),
    );
  }

  function markAllDone(status: TaskStatus) {
    const taskIds = tasksByStatus[status]
      .filter((task) => task.archived_at === null)
      .map((task) => task.id);
    if (taskIds.length === 0) return;

    startTransition(async () => {
      const result = await bulkActions.bulkFieldAction({
        taskIds,
        field: "status",
        value: "done",
        returnTo,
      });
      const message = summarizeBulk(result, "completed");
      setLiveMessage(message);
      setActionError(result.applied === 0 ? result.errorMessage ?? message : null);
      show({ message, tone: result.applied > 0 ? "success" : "error" });
      if (result.applied > 0) router.refresh();
    });
  }

  function archiveCompleted(status: TaskStatus) {
    const taskIds = tasksByStatus[status]
      .filter(
        (task) =>
          task.archived_at === null && isTaskCompletedStatus(task.status),
      )
      .map((task) => task.id);
    if (taskIds.length === 0) return;

    startTransition(async () => {
      const result = await bulkActions.bulkArchiveAction({
        taskIds,
        archived: true,
        returnTo,
      });
      const message = summarizeBulk(result, "archived");
      setLiveMessage(message);
      setActionError(result.applied === 0 ? result.errorMessage ?? message : null);

      if (result.applied > 0) {
        router.refresh();
        if (result.undoable && result.operationId) {
          const operationId = result.operationId;
          showUndo({
            message,
            undo: () => bulkActions.undoAction(operationId),
          });
        } else {
          show({ message, tone: "success" });
        }
      } else {
        show({ message: result.errorMessage ?? message, tone: "error" });
      }
    });
  }

  return (
    <div className="tasks-board-container flex flex-col gap-3 p-[18px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          Board order:{" "}
          <span className="font-semibold text-[color:var(--ega-text)]">
            {boardOrderLabel(boardOrder)}
          </span>
          {dragEnabled ? null : " — dragging needs manual order."}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {boardOrder !== "manual" ? (
            <Link
              href={manualHref}
              className="filter-pill"
              data-testid="kanban-switch-manual"
            >
              Switch to manual order
            </Link>
          ) : null}
          {boardOrder !== "priority" ? (
            <Link href={priorityHref} className="filter-pill">
              Sort by priority
            </Link>
          ) : null}
          {boardOrder ? (
            <Link href={defaultOrderHref} className="filter-pill">
              Use current sort
            </Link>
          ) : null}
        </div>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {liveMessage}
      </p>
      {actionError ? (
        <p className="feedback-block feedback-block-error" role="alert">
          {actionError}
        </p>
      ) : null}

      <DndContext
        sensors={dnd.sensors}
        collisionDetection={dnd.collisionDetection}
        accessibility={{
          announcements: dnd.announcements,
          screenReaderInstructions: { draggable: dnd.screenReaderInstructions },
        }}
        onDragStart={dnd.handleDragStart}
        onDragOver={dnd.handleDragOver}
        onDragEnd={dnd.handleDragEnd}
        onDragCancel={dnd.handleDragCancel}
      >
        <div className={cn("tasks-kanban-board", isPending ? "opacity-95" : "")}>
          {columns.map((column) => (
            <KanbanColumn
              key={column.status}
              status={column.status}
              label={column.label}
              tasks={optimisticTasks[column.status]}
              boardOrder={boardOrder}
              collapsed={collapsed.includes(column.status)}
              dragEnabled={dragEnabled}
              dropTarget={dnd.dropTarget}
              disabled={activeView !== "active"}
              onAddTask={() => addTask(column.status)}
              onToggleCollapse={() => toggleCollapse(column.status)}
              onSort={(order) => {
                if (order !== boardOrder) {
                  router.push(order === "manual" ? manualHref : priorityHref);
                }
              }}
              onMarkAllDone={() => markAllDone(column.status)}
              onArchiveCompleted={() => archiveCompleted(column.status)}
              onMoveUp={(taskId) => moveByStep(taskId, "up")}
              onMoveDown={(taskId) => moveByStep(taskId, "down")}
              onMoveToStatus={moveToStatus}
              cardProps={cardProps}
              signalToneFor={(task) =>
                getTaskSignalTone(task.status, task.priority)
              }
              errorFor={(task) =>
                taskUpdateTaskId === task.id ? taskUpdateError : null
              }
              taskTotalDurations={taskTotalDurations}
              subtaskCounts={subtaskCounts}
            />
          ))}
        </div>
      </DndContext>

      <KanbanBlockedReasonDialog
        open={blockedPrompt !== null}
        taskTitle={blockedPrompt?.title ?? null}
        pending={isPending}
        error={blockedPrompt?.error ?? null}
        onCancel={() => setBlockedPrompt(null)}
        onSubmit={(reason) => {
          const pendingMove = blockedPrompt;
          if (!pendingMove) return;
          setBlockedPrompt((current) =>
            current ? { ...current, error: null } : current,
          );
          startTransition(async () => {
            applyOptimistic({
              taskId: pendingMove.request.taskId,
              toStatus: pendingMove.request.toStatus,
              beforeTaskId: pendingMove.request.beforeTaskId,
              afterTaskId: pendingMove.request.afterTaskId,
            });
            const result = await moveAction({
              ...pendingMove.request,
              blockedReason: reason,
              returnTo,
            });
            if (result.ok) {
              const message = `Moved ${nameFor(pendingMove.request)} to ${columnLabels[pendingMove.request.toStatus]}.`;
              setActionError(null);
              setLiveMessage(message);
              setBlockedPrompt(null);
              focusTaskId.current = pendingMove.request.taskId;
              router.refresh();
              return;
            }
            setBlockedPrompt((current) =>
              current ? { ...current, error: result.message } : current,
            );
            setLiveMessage(result.message);
            router.refresh();
          });
        }}
      />
    </div>
  );
}
