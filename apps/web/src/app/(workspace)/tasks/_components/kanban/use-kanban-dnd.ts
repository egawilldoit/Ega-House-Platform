"use client";

import { useMemo, useState } from "react";
import {
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

import { isTaskStatus, type TaskStatus } from "@/lib/task-domain";
import type { TaskRecord } from "@/lib/services/task-service";

export const KANBAN_COLUMN_END_PREFIX = "kanban-column-end:";

export function kanbanColumnEndId(status: TaskStatus): string {
  return `${KANBAN_COLUMN_END_PREFIX}${status}`;
}

export type KanbanTasksByStatus = Record<TaskStatus, TaskRecord[]>;

export type KanbanDropTarget = {
  status: TaskStatus;
  index: number;
};

export type KanbanMoveRequest = {
  taskId: string;
  toStatus: TaskStatus;
  beforeTaskId: string | null;
  afterTaskId: string | null;
  expectedBeforeRank: string | null;
  expectedAfterRank: string | null;
  expectedUpdatedAt: string;
};

export function getTaskColumnStatus(
  tasksByStatus: KanbanTasksByStatus,
  taskId: string,
): TaskStatus | null {
  const statuses = Object.keys(tasksByStatus) as TaskStatus[];
  for (const status of statuses) {
    if (tasksByStatus[status].some((task) => task.id === taskId)) return status;
  }
  return null;
}

/**
 * Resolve the drop target from the card or column-end the pointer/keyboard is
 * over. `index` is an insertion point in the target column *after* removing the
 * dragged card, so the card at `index - 1` is the visible before-neighbour and
 * the card at `index` is the after-neighbour.
 */
export function resolveKanbanDropTarget(
  tasksByStatus: KanbanTasksByStatus,
  activeTaskId: string,
  overId: UniqueIdentifier,
  pointerIsBelowOverItem: boolean,
): KanbanDropTarget | null {
  const overKey = String(overId);
  if (overKey.startsWith(KANBAN_COLUMN_END_PREFIX)) {
    const status = overKey.slice(KANBAN_COLUMN_END_PREFIX.length);
    if (!isTaskStatus(status)) return null;
    return {
      status,
      index: tasksByStatus[status].filter((task) => task.id !== activeTaskId).length,
    };
  }

  const status = getTaskColumnStatus(tasksByStatus, overKey);
  if (!status) return null;
  const withoutActive = tasksByStatus[status].filter(
    (task) => task.id !== activeTaskId,
  );
  const overIndex = withoutActive.findIndex((task) => task.id === overKey);
  if (overIndex === -1) return null;
  return { status, index: pointerIsBelowOverItem ? overIndex + 1 : overIndex };
}

export function buildKanbanMoveRequest(
  tasksByStatus: KanbanTasksByStatus,
  activeTaskId: string,
  target: KanbanDropTarget,
): KanbanMoveRequest | null {
  const fromStatus = getTaskColumnStatus(tasksByStatus, activeTaskId);
  const task = fromStatus
    ? tasksByStatus[fromStatus].find((entry) => entry.id === activeTaskId)
    : undefined;
  if (!fromStatus || !task) return null;

  const withoutActive = tasksByStatus[target.status].filter(
    (entry) => entry.id !== activeTaskId,
  );
  const clampedIndex = Math.max(0, Math.min(withoutActive.length, target.index));
  const before = withoutActive[clampedIndex - 1] ?? null;
  const after = withoutActive[clampedIndex] ?? null;

  // Dropping back onto the card's current neighbours is a no-op, not a write.
  if (fromStatus === target.status) {
    const original = tasksByStatus[fromStatus];
    const originalIndex = original.findIndex((entry) => entry.id === activeTaskId);
    const originalBefore = original[originalIndex - 1]?.id ?? null;
    const originalAfter = original[originalIndex + 1]?.id ?? null;
    if (
      (before?.id ?? null) === originalBefore &&
      (after?.id ?? null) === originalAfter
    ) {
      return null;
    }
  }

  return {
    taskId: task.id,
    toStatus: target.status,
    beforeTaskId: before?.id ?? null,
    afterTaskId: after?.id ?? null,
    expectedBeforeRank: before?.board_rank ?? null,
    expectedAfterRank: after?.board_rank ?? null,
    expectedUpdatedAt: task.updated_at,
  };
}

/**
 * Local preview of a move. It only inserts between the requested neighbours;
 * the server's rank is authoritative and a rejected move is discarded by
 * `router.refresh()` at the end of the transition.
 */
export function applyKanbanOptimisticMove(
  tasksByStatus: KanbanTasksByStatus,
  move: {
    taskId: string;
    toStatus: TaskStatus;
    beforeTaskId: string | null;
    afterTaskId: string | null;
  },
): KanbanTasksByStatus {
  const fromStatus = getTaskColumnStatus(tasksByStatus, move.taskId);
  if (!fromStatus) return tasksByStatus;
  const task = tasksByStatus[fromStatus].find((entry) => entry.id === move.taskId);
  if (!task) return tasksByStatus;

  const next: KanbanTasksByStatus = {
    todo: [...tasksByStatus.todo],
    in_progress: [...tasksByStatus.in_progress],
    review: [...tasksByStatus.review],
    blocked: [...tasksByStatus.blocked],
    done: [...tasksByStatus.done],
  };
  next[fromStatus] = next[fromStatus].filter((entry) => entry.id !== move.taskId);
  const target = next[move.toStatus].filter((entry) => entry.id !== move.taskId);

  let insertionIndex = target.length;
  if (move.beforeTaskId) {
    const beforeIndex = target.findIndex((entry) => entry.id === move.beforeTaskId);
    if (beforeIndex !== -1) insertionIndex = beforeIndex + 1;
  } else if (move.afterTaskId) {
    const afterIndex = target.findIndex((entry) => entry.id === move.afterTaskId);
    if (afterIndex !== -1) insertionIndex = afterIndex;
  }

  target.splice(insertionIndex, 0, { ...task, status: move.toStatus });
  next[move.toStatus] = target;
  return next;
}

function isBelowOverItem(event: DragOverEvent | DragEndEvent): boolean {  const translated = event.active.rect.current.translated;
  const overRect = event.over?.rect;
  if (!translated || !overRect) return false;
  return translated.top + translated.height / 2 > overRect.top + overRect.height / 2;
}

/**
 * Drag mechanics for the board.
 *
 * The hook never mutates the board: it only resolves the drop target from the
 * last `over` container. The board applies an optimistic preview, writes through
 * the server action and refreshes, so a rejected move rolls back to the durable
 * order instead of leaving a local guess in place.
 */
export function useKanbanDnd(input: {
  tasksByStatus: KanbanTasksByStatus;
  columnLabels: Record<TaskStatus, string>;
  enabled: boolean;
  onMove: (request: KanbanMoveRequest) => void;
}) {
  const { tasksByStatus, columnLabels, enabled, onMove } = input;
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<KanbanDropTarget | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 220, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const collisionDetection: CollisionDetection = (args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      const cardCollision = pointerCollisions.find((collision) =>
        args.droppableContainers.some(
          (container) =>
            container.id === collision.id && container.data.current?.type === "card",
        ),
      );
      return cardCollision ? [cardCollision] : pointerCollisions;
    }
    const intersections = rectIntersection(args);
    if (intersections.length > 0) {
      const cardCollision = intersections.find((collision) =>
        args.droppableContainers.some(
          (container) =>
            container.id === collision.id && container.data.current?.type === "card",
        ),
      );
      return cardCollision ? [cardCollision] : intersections;
    }
    return closestCenter(args);
  };

  const activeTask = activeTaskId
    ? (Object.values(tasksByStatus)
        .flat()
        .find((task) => task.id === activeTaskId) ?? null)
    : null;

  const announcements: Announcements = useMemo(
    () => ({
      onDragStart({ active }) {
        const task = Object.values(tasksByStatus)
          .flat()
          .find((entry) => entry.id === String(active.id));
        return `Picked up ${task?.title ?? "task"}. Use arrow keys to move, Enter or Space to drop, Escape to cancel.`;
      },
      onDragOver({ active, over }) {
        if (!over) return "Not over a column.";
        const target = resolveKanbanDropTarget(
          tasksByStatus,
          String(active.id),
          over.id,
          false,
        );
        return target
          ? `Over ${columnLabels[target.status]} at position ${target.index + 1}.`
          : "Not over a column.";
      },
      onDragEnd({ active, over }) {
        if (!over) return "Move cancelled.";
        const target = resolveKanbanDropTarget(
          tasksByStatus,
          String(active.id),
          over.id,
          false,
        );
        return target
          ? `Dropped in ${columnLabels[target.status]} at position ${target.index + 1}.`
          : "Move cancelled.";
      },
      onDragCancel() {
        return "Move cancelled.";
      },
    }),
    [tasksByStatus, columnLabels],
  );

  function handleDragStart(event: DragStartEvent) {
    if (!enabled) return;
    setActiveTaskId(String(event.active.id));
  }

  function handleDragOver(event: DragOverEvent) {
    if (!enabled || !event.over) {
      setDropTarget(null);
      return;
    }
    setDropTarget(
      resolveKanbanDropTarget(
        tasksByStatus,
        String(event.active.id),
        event.over.id,
        isBelowOverItem(event),
      ),
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTaskId(null);
    setDropTarget(null);
    if (!enabled || !event.over) return;
    const target = resolveKanbanDropTarget(
      tasksByStatus,
      String(event.active.id),
      event.over.id,
      isBelowOverItem(event),
    );
    if (!target) return;
    const request = buildKanbanMoveRequest(
      tasksByStatus,
      String(event.active.id),
      target,
    );
    if (request) onMove(request);
  }

  function handleDragCancel() {
    setActiveTaskId(null);
    setDropTarget(null);
  }

  return {
    sensors,
    collisionDetection,
    announcements,
    activeTask,
    activeTaskId,
    dropTarget,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
    screenReaderInstructions:
      "To move a card with the keyboard: focus its move handle, press Enter or Space, use the arrow keys to choose a column and position, then press Enter or Space to drop. Press Escape to cancel.",
  };
}
