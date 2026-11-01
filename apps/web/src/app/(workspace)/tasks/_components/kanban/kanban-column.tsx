"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { TaskRecord } from "@/lib/services/task-service";
import { isTaskCompletedStatus, type TaskStatus } from "@/lib/task-domain";
import { cn } from "@/lib/utils";

import { KanbanCard, type KanbanCardProps } from "./kanban-card";
import { KanbanColumnMenu } from "./kanban-column-menu";
import { kanbanColumnEndId, type KanbanDropTarget } from "./use-kanban-dnd";
import type { TaskBoardOrder } from "@/lib/task-list";

type KanbanColumnProps = {
  status: TaskStatus;
  label: string;
  tasks: TaskRecord[];
  boardOrder: TaskBoardOrder | null;
  collapsed: boolean;
  dragEnabled: boolean;
  dropTarget: KanbanDropTarget | null;
  disabled: boolean;
  onAddTask: () => void;
  onToggleCollapse: () => void;
  onSort: (order: TaskBoardOrder) => void;
  onMarkAllDone: () => void;
  onArchiveCompleted: () => void;
  onMoveUp: (taskId: string) => void;
  onMoveDown: (taskId: string) => void;
  onMoveToStatus: (taskId: string, status: TaskStatus) => void;
  cardProps: KanbanCardProps["cardProps"];
  signalToneFor: (task: TaskRecord) => string;
  errorFor: (task: TaskRecord) => string | null;
  taskTotalDurations: Record<string, number | undefined>;
  subtaskCounts: Record<string, { done: number; total: number } | undefined>;
};

/** Status columns and the manual-order controls for one column (EGA-785). */
export function KanbanColumn({
  status,
  label,
  tasks,
  boardOrder,
  collapsed,
  dragEnabled,
  dropTarget,
  disabled,
  onAddTask,
  onToggleCollapse,
  onSort,
  onMarkAllDone,
  onArchiveCompleted,
  onMoveUp,
  onMoveDown,
  onMoveToStatus,
  cardProps,
  signalToneFor,
  errorFor,
  taskTotalDurations,
  subtaskCounts,
}: KanbanColumnProps) {
  const endId = kanbanColumnEndId(status);
  const { setNodeRef: setEndRef } = useDroppable({
    id: endId,
    data: { type: "column-end", status },
  });
  const completedCount = tasks.filter((task) =>
    isTaskCompletedStatus(task.status),
  ).length;
  const activeDropIndex =
    dropTarget?.status === status ? dropTarget.index : null;

  return (
    <section
      className="tasks-kanban-column"
      aria-label={`${label} column`}
      data-testid={`kanban-column-${status}`}
    >
      <div className="tasks-kanban-column-header">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate">{label}</h2>
          <Badge tone="muted">
            {tasks.length} task{tasks.length === 1 ? "" : "s"}
          </Badge>
          {boardOrder === "manual" ? (
            <span className="text-[length:var(--text-micro)] uppercase tracking-[0.08em] text-[color:var(--ega-text-tertiary)]">
              Manual
            </span>
          ) : null}
        </div>
        <KanbanColumnMenu
          status={status}
          label={label}
          taskCount={tasks.length}
          completedCount={completedCount}
          collapsed={collapsed}
          boardOrder={boardOrder}
          disabled={disabled}
          onAddTask={onAddTask}
          onToggleCollapse={onToggleCollapse}
          onSort={onSort}
          onMarkAllDone={onMarkAllDone}
          onArchiveCompleted={onArchiveCompleted}
        />
      </div>

      {collapsed ? (
        <button
          type="button"
          className="rounded-[var(--radius-sm)] border border-dashed border-[var(--ega-border-strong)] bg-[var(--ega-surface)] px-3 py-2 text-left text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)] hover:text-[color:var(--ega-text)]"
          onClick={onToggleCollapse}
          aria-expanded={false}
        >
          Column collapsed — {tasks.length} task{tasks.length === 1 ? "" : "s"}. Expand
        </button>
      ) : (
        <SortableContext
          items={[...tasks.map((task) => task.id), endId]}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex min-h-16 flex-col gap-2">
            {tasks.length === 0 && activeDropIndex === null ? (
              <div className="flex flex-col items-center gap-2 rounded-[var(--radius-sm)] border border-dashed border-[var(--ega-border-strong)] bg-[var(--ega-surface)] px-3 py-6 text-center">
                <p className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-tertiary)]">
                  No {label.toLowerCase()} tasks
                </p>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[length:var(--text-meta)] font-medium text-[color:var(--ega-text-secondary)] hover:text-[color:var(--ega-text)]"
                  onClick={onAddTask}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add task here
                </button>
              </div>
            ) : null}

            {tasks.map((task, index) => (
              <div key={task.id} className="flex flex-col gap-2">
                {activeDropIndex === index ? <KanbanDropLine /> : null}
                <KanbanCard
                  task={task}
                  signalTone={signalToneFor(task)}
                  dragEnabled={dragEnabled}
                  canMoveUp={index > 0}
                  canMoveDown={index < tasks.length - 1}
                  onMoveUp={() => onMoveUp(task.id)}
                  onMoveDown={() => onMoveDown(task.id)}
                  onMoveToStatus={(nextStatus) => onMoveToStatus(task.id, nextStatus)}
                  cardProps={cardProps}
                  error={errorFor(task)}
                  trackedSeconds={taskTotalDurations[task.id]}
                  subtaskCount={subtaskCounts[task.id] ?? null}
                />
                {activeDropIndex === index + 1 && index === tasks.length - 1 ? (
                  <KanbanDropLine />
                ) : null}
              </div>
            ))}

            <div
              ref={setEndRef}
              className={cn(
                "flex min-h-6 items-center justify-center rounded-[var(--radius-sm)]",
                activeDropIndex === tasks.length ? "bg-[var(--ega-accent-soft)]" : "",
              )}
              data-testid={`kanban-column-end-${status}`}
            >
              {activeDropIndex === tasks.length && tasks.length > 0 ? (
                <KanbanDropLine />
              ) : null}
            </div>
          </div>
        </SortableContext>
      )}
    </section>
  );
}

function KanbanDropLine() {
  return (
    <div
      className="h-0.5 w-full rounded-full bg-[var(--ega-accent)]"
      aria-hidden="true"
      data-testid="kanban-drop-line"
    />
  );
}
