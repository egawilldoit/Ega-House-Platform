"use client";

import { useRef } from "react";

import { EditTaskModal, type EditTaskModalProps } from "@/components/tasks/edit-task-modal";
import { useTaskEditorOpenState } from "@/components/tasks/use-task-editor-open-state";

type TaskEditModalTriggerProps = Omit<
  EditTaskModalProps,
  "open" | "onOpenChange" | "trigger"
>;

export function TaskEditModalTrigger(props: TaskEditModalTriggerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { open, handleOpenChange } = useTaskEditorOpenState({
    taskId: props.taskId,
    error: props.error ?? null,
  });

  return (
    <EditTaskModal
      {...props}
      open={open}
      onOpenChange={handleOpenChange}
      restoreFocusRef={triggerRef}
      trigger={
        <button
          ref={triggerRef}
          type="button"
          className="min-w-0 max-w-full cursor-pointer rounded-[var(--radius-xs)] text-left text-sm font-semibold leading-5 text-[color:var(--ega-text)] outline-none hover:underline focus-visible:outline-[var(--ega-focus-outline)] focus-visible:outline-offset-2"
          title={props.taskTitle}
          aria-label={`Edit ${props.taskTitle}`}
          data-testid={`task-kanban-edit-${props.taskId}`}
          onClick={(event) => event.currentTarget.focus()}
        >
          <span className="line-clamp-2">{props.taskTitle}</span>
        </button>
      }
    />
  );
}
