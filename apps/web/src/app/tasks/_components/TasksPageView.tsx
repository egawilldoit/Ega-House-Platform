import Link from "next/link";
import {
  archiveManyCompletedTasksAction,
  archiveTaskAction,
  cancelTaskReminderAction,
  createTaskReminderAction,
  deleteTaskAction,
  pinTaskAction,
  unarchiveTaskAction,
  unpinTaskAction,
  updateTaskInlineAction,
  updateTaskEditorAction,
} from "@/app/tasks/actions";
import { startTimerAction } from "@/app/timer/actions";
import { TaskFilterControls } from "@/components/tasks/task-filter-controls";
import { TaskKanbanCard } from "@/components/tasks/task-kanban-card";
import { TasksNewTaskButton } from "@/components/tasks/tasks-new-task-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterPill } from "@/components/ui/filter-pill";
import { buildTaskListUrl } from "@/lib/task-list";
import { isTaskCompletedStatus } from "@/lib/task-domain";
import { formatDisplayCount } from "@/lib/presentation-format";
import { ListChecks } from "lucide-react";
import type { TasksPageModel } from "../_lib/tasks-page-model";
import { TasksListTable, type TaskListActions } from "./tasks-list-table";

function getTaskSignalTone(status: string, priority: string) {
  if (status === "blocked" || priority === "urgent") return "bg-[var(--status-overdue)]";
  if (priority === "high") return "bg-[var(--status-risk)]";
  if (status === "in_progress") return "bg-[var(--status-info)]";
  return "bg-[var(--ega-text-tertiary)]";
}

/**
 * Bulk cleanup targets only completed tasks that are not yet archived, inside
 * the already-rendered Current scope. Eligibility is re-verified server-side by
 * `archiveManyCompletedTasksAction`; the submitted ids just seed the intent.
 */
export function getArchivableCompletedTaskIds(
  tasks: Array<Pick<TasksPageModel["tasks"][number], "id" | "status" | "archived_at">>,
) {
  return tasks.filter((task) => isTaskCompletedStatus(task.status) && task.archived_at === null).map((task) => task.id);
}

/**
 * `active` is the not-archived scope (done tasks stay visible), so the tab is
 * labelled "Current" rather than claiming a status.
 */
const TASK_VIEWS = [
  { value: "active", label: "Current" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
] as const;

export function TasksPageView({ model }: { model: TasksPageModel }) {
  const {
    parsed,
    projects,
    goals,
    tasks,
    taskTotalDurations,
    summary,
    activeProjectId,
    activeGoalId,
    returnPath,
    taskUrlFilters,
    kanbanBoard,
    inProgressCount,
    blockedCount,
    overdueCount,
    dueSoonCount,
  } = model;
  const { activeStatus, activeView, activeLayout, activeDueFilter, savedViewDefinitionFilters } = parsed;
  const completedTaskIdsInScope = getArchivableCompletedTaskIds(tasks);
  // Restore clears archived state only; it must never resurrect a completed
  // task as unfinished work.
  const showBulkArchive = activeView === "active" && completedTaskIdsInScope.length > 0;
  const taskUpdateError = parsed.taskUpdateError;
  const taskUpdateSuccess = parsed.taskUpdateSuccess;
  const taskUpdateTaskId = parsed.taskUpdateTaskId;

  const listHref = buildTaskListUrl("/tasks", { ...taskUrlFilters, view: activeView, layout: "list" });
  const kanbanHref = buildTaskListUrl("/tasks", { ...taskUrlFilters, view: activeView, layout: "kanban" });
  const hasAnyTasks = summary.total > 0;
  const summaryParts = [
    `${formatDisplayCount(tasks.length)} shown`,
    `${formatDisplayCount(summary.total)} total`,
  ];
  if (overdueCount > 0) summaryParts.push(`${formatDisplayCount(overdueCount)} overdue`);
  if (inProgressCount > 0) summaryParts.push(`${formatDisplayCount(inProgressCount)} in progress`);
  if (blockedCount > 0) summaryParts.push(`${formatDisplayCount(blockedCount)} blocked`);
  if (dueSoonCount > 0) summaryParts.push(`${formatDisplayCount(dueSoonCount)} due soon`);

  const taskListActions: TaskListActions = {
    updateAction: updateTaskInlineAction,
    updateEditorAction: updateTaskEditorAction,
    deleteAction: deleteTaskAction,
    archiveAction: archiveTaskAction,
    unarchiveAction: unarchiveTaskAction,
    startTimerAction,
    pinAction: pinTaskAction,
    unpinAction: unpinTaskAction,
    createReminderAction: createTaskReminderAction,
    cancelReminderAction: cancelTaskReminderAction,
  };

  const bulkArchiveControl = showBulkArchive ? (
    <form
      action={archiveManyCompletedTasksAction}
      onSubmit={(event) => {
        // Same confirmation convention as task delete: plain window.confirm with
        // language that frames archiving as restorable, never as deletion.
        const confirmed = window.confirm(
          `Archive ${completedTaskIdsInScope.length} completed task${
            completedTaskIdsInScope.length === 1 ? "" : "s"
          }? These tasks will move to Archived and can be restored later.`,
        );
        if (!confirmed) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="returnTo" value={returnPath} />
      <input type="hidden" name="confirmArchiveCompleted" value="true" />
      {completedTaskIdsInScope.map((taskId) => (
        <input key={taskId} type="hidden" name="taskIds" value={taskId} />
      ))}
      <button
        type="submit"
        className="btn-instrument btn-instrument-muted h-8 gap-1.5 px-3 text-sm"
        data-testid="tasks-archive-completed"
      >
        Archive completed ({completedTaskIdsInScope.length})
      </button>
    </form>
  ) : null;

  const emptyState = (
    <EmptyState
      icon={ListChecks}
      title={hasAnyTasks ? "No tasks match current filters" : "No tasks yet"}
      description={
        hasAnyTasks
          ? "Reset one or more filters to bring the execution queue back into view."
          : "Create a task to start the execution queue."
      }
      action={
        hasAnyTasks ? (
          <Link
            href="/tasks"
            className="btn-instrument btn-instrument-muted inline-flex h-8 items-center px-3 text-xs"
          >
            Reset filters
          </Link>
        ) : undefined
      }
    />
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-4">
        <Card clip>
          <div className="flex flex-col gap-3 border-b border-[var(--ega-divider)] px-[18px] py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Task views">
                {TASK_VIEWS.map((view) => {
                  const isActive = activeView === view.value;
                  return (
                    <FilterPill
                      key={view.value}
                      href={buildTaskListUrl("/tasks", {
                        ...taskUrlFilters,
                        view: view.value,
                        layout: activeLayout,
                      })}
                      label={view.label}
                      active={isActive}
                      ariaCurrent={isActive ? "page" : undefined}
                    />
                  );
                })}
              </div>

              <span className="hidden h-4 w-px bg-[var(--ega-border)] sm:block" aria-hidden="true" />

              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Task layout">
                <FilterPill
                  href={listHref}
                  label="List"
                  active={activeLayout === "list"}
                  ariaCurrent={activeLayout === "list" ? "page" : undefined}
                />
                <FilterPill
                  href={kanbanHref}
                  label="Board"
                  active={activeLayout === "kanban"}
                  ariaCurrent={activeLayout === "kanban" ? "page" : undefined}
                />
              </div>

              <div className="ml-auto flex items-center gap-2">
                {bulkArchiveControl}
                <TasksNewTaskButton testId="tasks-new-task" />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <TaskFilterControls
                basePath="/tasks"
                activeStatus={activeStatus}
                activePriority={savedViewDefinitionFilters.priorityValues.join(",")}
                activeProjectId={activeProjectId}
                activeGoalId={activeGoalId}
                activeDueFilter={activeDueFilter}
                activeSort={parsed.activeSort}
                activeView={activeView}
                activeLayout={activeLayout}
                activeEstimateMin={savedViewDefinitionFilters.estimateMinMinutes}
                activeEstimateMax={savedViewDefinitionFilters.estimateMaxMinutes}
                activeDueWithin={savedViewDefinitionFilters.dueWithinDays}
                activeTasksOnly={savedViewDefinitionFilters.activeTasks}
                projectOptions={projects}
                goalOptions={goals.map((g) => ({ id: g.id, title: g.title }))}
              />
              <p
                className="ml-auto min-w-0 text-[length:var(--text-meta)] tabular-nums text-[color:var(--ega-text-tertiary)]"
                data-testid="tasks-summary"
              >
                {summaryParts.join(" · ")}
              </p>
            </div>
          </div>

          {taskUpdateSuccess ? (
            <p className="feedback-block m-[18px]">{taskUpdateSuccess}</p>
          ) : null}

          {activeLayout === "kanban" ? (
            tasks.length === 0 ? (
              emptyState
            ) : (
              <div className="tasks-board-container p-[18px]">
                <div className="tasks-kanban-board">
                  {kanbanBoard.columns.map((column) => {
                    const columnTasks = kanbanBoard.tasksByStatus[column.status];
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
                          <div className="flex flex-col gap-2">
                            {columnTasks.map((task) => {
                              const inlineError = taskUpdateTaskId === task.id ? taskUpdateError : null;
                              return (
                                <TaskKanbanCard
                                  key={task.id}
                                  task={task}
                                  signalTone={getTaskSignalTone(task.status, task.priority)}
                                  updateAction={updateTaskInlineAction}
                                  startTimerAction={startTimerAction}
                                  pinAction={pinTaskAction}
                                  unpinAction={unpinTaskAction}
                                  archiveAction={archiveTaskAction}
                                  unarchiveAction={unarchiveTaskAction}
                                  deleteAction={deleteTaskAction}
                                  createReminderAction={createTaskReminderAction}
                                  cancelReminderAction={cancelTaskReminderAction}
                                  returnTo={returnPath}
                                  trackedSeconds={taskTotalDurations[task.id]}
                                  error={inlineError}
                                />
                              );
                            })}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              </div>
            )
          ) : tasks.length === 0 ? (
            emptyState
          ) : (
            <TasksListTable
              tasks={tasks}
              taskTotalDurations={taskTotalDurations}
              returnTo={returnPath}
              taskUpdateTaskId={taskUpdateTaskId}
              taskUpdateError={taskUpdateError}
              actions={taskListActions}
            />
          )}
        </Card>
      </div>

    </div>
  );
}
