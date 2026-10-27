"use client";

import type { TaskDrawerDetail } from "@/lib/services/task-service";
import { StatusIcon, type TaskStatusIconName } from "@/components/ui/status-icon";
import { PriorityIcon, type TaskPriorityIconName } from "@/components/ui/priority-icon";
import { TaskDrawer } from "./task-drawer";
import { useTaskDrawerParam } from "./use-task-drawer-param";

const KNOWN_STATUSES: TaskStatusIconName[] = ["todo", "in_progress", "done", "blocked"];
const KNOWN_PRIORITIES: TaskPriorityIconName[] = ["low", "medium", "high", "urgent"];

function isStatus(value: string): value is TaskStatusIconName {
  return (KNOWN_STATUSES as string[]).includes(value);
}

function isPriority(value: string): value is TaskPriorityIconName {
  return (KNOWN_PRIORITIES as string[]).includes(value);
}

type TaskDrawerHostProps = {
  /** Owner-scoped detail loaded by the page model, or null. */
  task: TaskDrawerDetail | null;
};

/**
 * Mount point for the selected-task drawer.
 *
 * The URL is the authority: the drawer opens iff `?task=` is present, so direct
 * links and Back/Forward work without extra state. When the id resolves to
 * nothing the drawer still opens but shows an unavailable state that is
 * identical for a missing task and for another owner's task.
 */
export function TaskDrawerHost({ task }: TaskDrawerHostProps) {
  const { taskId, mode, close, setMode } = useTaskDrawerParam();

  if (!taskId) {
    return <TaskDrawer task={null} mode={mode} onClose={close} onModeChange={setMode} />;
  }

  if (!task || task.id !== taskId) {
    return (
      <TaskDrawer
        task={{ id: taskId, title: "Task unavailable", status: "unknown" }}
        mode={mode}
        onClose={close}
        onModeChange={setMode}
      >
        <p className="text-sm text-[color:var(--ega-text-secondary)]">
          This task is not available. It may have been deleted, or the link may be
          wrong.
        </p>
      </TaskDrawer>
    );
  }

  return (
    <TaskDrawer
      task={{ id: task.id, title: task.title, status: task.status }}
      mode={mode}
      onClose={close}
      onModeChange={setMode}
    >
      <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-y-2 text-sm">
        <dt className="text-[color:var(--ega-text-tertiary)]">Status</dt>
        <dd className="flex items-center gap-1.5 text-[color:var(--ega-text)]">
          {isStatus(task.status) ? <StatusIcon status={task.status} decorative /> : null}
          {task.status.replace(/_/g, " ")}
        </dd>
        <dt className="text-[color:var(--ega-text-tertiary)]">Priority</dt>
        <dd className="flex items-center gap-1.5 text-[color:var(--ega-text)]">
          {isPriority(task.priority) ? (
            <PriorityIcon priority={task.priority} decorative />
          ) : null}
          {task.priority}
        </dd>
        <dt className="text-[color:var(--ega-text-tertiary)]">Due</dt>
        <dd className="text-[color:var(--ega-text)]">{task.due_date ?? "No due date"}</dd>
      </dl>
    </TaskDrawer>
  );
}
