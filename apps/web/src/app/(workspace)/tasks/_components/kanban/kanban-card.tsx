"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, MoveRight } from "lucide-react";
import type { ComponentProps, CSSProperties, ReactNode, Ref } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  TaskKanbanCard,
  getTaskKanbanStatusActionLabel,
} from "@/components/tasks/task-kanban-card";
import { getTaskStatusTransitions } from "@ega/domain";
import type { TaskStatus } from "@/lib/task-domain";
import type { TaskRecord } from "@/lib/services/task-service";
import { cn } from "@/lib/utils";

type CardActionProps = Omit<
  ComponentProps<typeof TaskKanbanCard>,
  "task" | "signalTone" | "error"
>;

export type KanbanCardProps = {
  task: TaskRecord;
  signalTone: string;
  dragEnabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMoveToStatus: (status: TaskStatus) => void;
  cardProps: CardActionProps;
  error?: string | null;
  trackedSeconds?: number;
  subtaskCount?: { done: number; total: number } | null;
};

const toolbarButtonClass =
  "inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border border-transparent text-[color:var(--ega-text-tertiary)] transition-colors hover:border-[var(--ega-border)] hover:bg-[var(--ega-surface-hover)] hover:text-[color:var(--ega-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-accent)] disabled:cursor-not-allowed disabled:opacity-40";

function CardToolbar({
  task,
  dragEnabled,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onMoveToStatus,
  dragHandle,
}: Pick<
  KanbanCardProps,
  | "task"
  | "dragEnabled"
  | "canMoveUp"
  | "canMoveDown"
  | "onMoveUp"
  | "onMoveDown"
  | "onMoveToStatus"
> & { dragHandle?: ReactNode }) {
  const nextStatuses = getTaskStatusTransitions(task.status);

  return (
    <div className="flex items-center justify-end gap-1 px-1 pb-1">
      {dragEnabled ? (
        <>
          {dragHandle}
          <button
            type="button"
            className={toolbarButtonClass}
            aria-label={`Move ${task.title} up`}
            disabled={!canMoveUp}
            onClick={onMoveUp}
          >
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={toolbarButtonClass}
            aria-label={`Move ${task.title} down`}
            disabled={!canMoveDown}
            onClick={onMoveDown}
          >
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
          </button>
        </>
      ) : null}

      {nextStatuses.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(toolbarButtonClass, "w-auto gap-1 px-2 text-[length:var(--text-meta)]")}
              aria-label={`Move ${task.title} to another status`}
            >
              <MoveRight className="h-3.5 w-3.5" aria-hidden="true" />
              Move
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Move to status</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {nextStatuses.map((status) => (
              <DropdownMenuItem
                key={status}
                onSelect={() => onMoveToStatus(status)}
              >
                {getTaskKanbanStatusActionLabel(status)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function KanbanCardFrame({
  task,
  signalTone,
  dragEnabled,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onMoveToStatus,
  cardProps,
  error,
  trackedSeconds,
  subtaskCount,
  nodeRef,
  style,
  isDragging = false,
  dragHandle,
}: KanbanCardProps & {
  nodeRef?: Ref<HTMLElement>;
  style?: CSSProperties;
  isDragging?: boolean;
  dragHandle?: ReactNode;
}) {
  return (
    <article
      ref={nodeRef}
      id={`kanban-card-${task.id}`}
      tabIndex={-1}
      style={style}
      data-kanban-card-id={task.id}
      className={cn(
        "scroll-mt-24 rounded-[var(--radius-md)] outline-none transition-shadow",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-accent)]",
        isDragging ? "z-10 opacity-90 shadow-[var(--ega-shadow-drag)] motion-land" : "shadow-none",
      )}
    >
      <CardToolbar
        task={task}
        dragEnabled={dragEnabled}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onMoveToStatus={onMoveToStatus}
        dragHandle={dragHandle}
      />
      <TaskKanbanCard
        task={task}
        signalTone={signalTone}
        error={error}
        trackedSeconds={trackedSeconds}
        subtaskCount={subtaskCount}
        {...cardProps}
      />
    </article>
  );
}

function SortableKanbanCard(props: KanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: props.task.id,
    data: { type: "card", status: props.task.status },
  });

  return (
    <KanbanCardFrame
      {...props}
      nodeRef={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      isDragging={isDragging}
      dragHandle={
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          type="button"
          className={cn(toolbarButtonClass, "cursor-grab active:cursor-grabbing")}
          aria-label={`Drag ${props.task.title}`}
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>
      }
    />
  );
}

/**
 * Sortable card shell.
 *
 * The visible grip is the activator for pointer, touch and keyboard dragging.
 * Move up/down are the non-drag ordering alternative; the Move menu changes
 * status. Whether ordering controls exist at all is decided by the board: they
 * only appear under Manual sort.
 */
export function KanbanCard(props: KanbanCardProps) {
  if (!props.dragEnabled) {
    return <KanbanCardFrame {...props} />;
  }
  return <SortableKanbanCard {...props} />;
}
