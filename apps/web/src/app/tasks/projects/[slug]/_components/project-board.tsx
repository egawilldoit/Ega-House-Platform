import { ListChecks } from "lucide-react";

import type { UpdateTaskEditorAction } from "@/components/tasks/edit-task-modal";
import type { TaskRecord } from "@/lib/services/task-service";

import { TaskKanbanCard } from "@/components/tasks/task-kanban-card";
import { getTaskSignalTone } from "@/components/tasks/task-signal";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { buildTaskKanbanBoard } from "@/lib/task-list";
import type { TaskStatus } from "@/lib/task-domain";

type ProjectBoardProps = {
  tasks: TaskRecord[];
  activeStatus: TaskStatus | null;
  returnTo: string;
  taskTotalDurations: Record<string, number>;
  projectOptions: Array<{ id: string; name: string }>;
  goalOptions: Array<{ id: string; title: string; projectId: string }>;
  actions: {
    updateAction?: (formData: FormData) => void | Promise<void>;
    updateEditorAction?: UpdateTaskEditorAction;
    startTimerAction?: (formData: FormData) => void | Promise<void>;
    pinAction?: (formData: FormData) => void | Promise<void>;
    unpinAction?: (formData: FormData) => void | Promise<void>;
    archiveAction?: (formData: FormData) => void | Promise<void>;
    unarchiveAction?: (formData: FormData) => void | Promise<void>;
    deleteAction?: (formData: FormData) => void | Promise<void>;
    createReminderAction?: (formData: FormData) => void | Promise<void>;
    updateReminderAction?: (formData: FormData) => void | Promise<void>;
    cancelReminderAction?: (formData: FormData) => void | Promise<void>;
  };
  errorForTask?: (taskId: string) => string | null;
  updateSuccess?: string | null;
  updateError?: string | null;
};

const EMPTY_BOARD_MESSAGE = "No tasks match the current filters.";

export function ProjectBoard({
  tasks,
  activeStatus,
  returnTo,
  taskTotalDurations,
  projectOptions,
  goalOptions,
  actions,
  errorForTask,
  updateSuccess,
  updateError,
}: ProjectBoardProps) {
  const board = buildTaskKanbanBoard(tasks, activeStatus);

  return (
    <Card
      label="Execution"
      title="Board"
      action={<Badge tone="muted">{tasks.length}</Badge>}
    >
      {updateSuccess ? (
        <p role="status" className="feedback-block mx-[var(--panel-pad,18px)] mt-4">
          {updateSuccess}
        </p>
      ) : null}
      {updateError ? (
        <p role="alert" className="feedback-block feedback-block-error mx-[var(--panel-pad,18px)] mt-4">
          {updateError}
        </p>
      ) : null}
      {tasks.length === 0 ? (
        <CardContent>
          <EmptyState
            icon={ListChecks}
            title="No tasks on the board"
            description={EMPTY_BOARD_MESSAGE}
          />
        </CardContent>
      ) : (
        <CardContent>
          <div className="tasks-board-container">
            <div className="tasks-kanban-board">
              {board.columns.map((column) => {
                const columnTasks = board.tasksByStatus[column.status];
                return (
                  <section key={column.status} className="tasks-kanban-column">
                    <div className="tasks-kanban-column-header">
                      <h2>{column.label}</h2>
                      <Badge tone="muted">
                        {columnTasks.length} task{columnTasks.length === 1 ? "" : "s"}
                      </Badge>
                    </div>
                    {columnTasks.length === 0 ? (
                      <p className="rounded-[var(--radius-sm)] border border-dashed border-[var(--ega-border-strong)] bg-[var(--ega-surface)] px-3 py-6 text-center text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-tertiary)]">
                        No {column.label.toLowerCase()} tasks
                      </p>
                    ) : (
                      <div className="flex max-h-[32rem] flex-col gap-2 overflow-y-auto pr-1">
                        {columnTasks.map((task) => (
                          <TaskKanbanCard
                            key={task.id}
                            task={task}
                            signalTone={getTaskSignalTone(task.status, task.priority)}
                            updateAction={actions.updateAction}
                            updateEditorAction={actions.updateEditorAction}
                            startTimerAction={actions.startTimerAction}
                            pinAction={actions.pinAction}
                            unpinAction={actions.unpinAction}
                            archiveAction={actions.archiveAction}
                            unarchiveAction={actions.unarchiveAction}
                            deleteAction={actions.deleteAction}
                            createReminderAction={actions.createReminderAction}
                            updateReminderAction={actions.updateReminderAction}
                            cancelReminderAction={actions.cancelReminderAction}
                            projectOptions={projectOptions}
                            goalOptions={goalOptions}
                            returnTo={returnTo}
                            trackedSeconds={taskTotalDurations[task.id]}
                            error={errorForTask?.(task.id) ?? null}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
