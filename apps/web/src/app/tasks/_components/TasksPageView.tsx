import Link from "next/link";
import {
  archiveTaskAction,
  cancelTaskReminderAction,
  createTaskReminderAction,
  deleteTaskAction,
  pinTaskAction,
  unarchiveTaskAction,
  unpinTaskAction,
  updateTaskInlineAction,
} from "@/app/tasks/actions";
import { startTimerAction } from "@/app/timer/actions";
import { CreateTaskForm } from "@/app/tasks/create-task-form";
import { FocusPinToggleForm } from "@/components/tasks/focus-pin-toggle-form";
import { TaskFilterControls } from "@/components/tasks/task-filter-controls";
import { TaskKanbanCard } from "@/components/tasks/task-kanban-card";
import { TaskSavedViewsPanel } from "@/components/tasks/task-saved-views-panel";
import { TasksNewTaskButton } from "@/components/tasks/tasks-new-task-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterPill } from "@/components/ui/filter-pill";
import { buildTaskListUrl } from "@/lib/task-list";
import { ListChecks } from "lucide-react";
import type { TasksPageModel } from "../_lib/tasks-page-model";
import { TasksListTable, type TaskListActions } from "./tasks-list-table";

function getTaskSignalTone(status: string, priority: string) {
  if (status === "blocked" || priority === "urgent") return "bg-[var(--status-overdue)]";
  if (priority === "high") return "bg-[var(--status-risk)]";
  if (status === "in_progress") return "bg-[var(--status-healthy)]";
  return "bg-[var(--ega-text-tertiary)]";
}

const TASK_VIEWS = [
  { value: "active", label: "Active" },
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
    savedViews,
    resolvedSavedViewFeedback,
    calendarFormDefaults,
    activeProjectId,
    activeGoalId,
    returnPath,
    taskUrlFilters,
    focusQueue,
    kanbanBoard,
    inProgressCount,
    blockedCount,
    overdueCount,
    dueSoonCount,
  } = model;
  const { activeStatus, activeView, activeLayout, activeDueFilter, savedViewDefinitionFilters } = parsed;
  const taskUpdateError = parsed.taskUpdateError;
  const taskUpdateSuccess = parsed.taskUpdateSuccess;
  const taskUpdateTaskId = parsed.taskUpdateTaskId;

  const listHref = buildTaskListUrl("/tasks", { ...taskUrlFilters, view: activeView, layout: "list" });
  const kanbanHref = buildTaskListUrl("/tasks", { ...taskUrlFilters, view: activeView, layout: "kanban" });
  const archivedTaskCount = summary.archived;
  const hasAnyTasks = summary.total > 0;

  const taskListActions: TaskListActions = {
    updateAction: updateTaskInlineAction,
    deleteAction: deleteTaskAction,
    archiveAction: archiveTaskAction,
    unarchiveAction: unarchiveTaskAction,
    startTimerAction,
    pinAction: pinTaskAction,
    unpinAction: unpinTaskAction,
    createReminderAction: createTaskReminderAction,
    cancelReminderAction: cancelTaskReminderAction,
  };

  const emptyState = (
    <EmptyState
      icon={ListChecks}
      title={hasAnyTasks ? "No tasks match current filters" : "No tasks yet"}
      description={
        hasAnyTasks
          ? "Reset one or more filters to bring the execution queue back into view."
          : "Create a task to start the execution queue. Filters and saved views stay available."
      }
      action={
        hasAnyTasks ? (
          <Link
            href="/tasks"
            className="btn-instrument btn-instrument-muted inline-flex h-8 items-center px-3 text-xs"
          >
            Reset filters
          </Link>
        ) : (
          <TasksNewTaskButton label="New task" />
        )
      }
    />
  );

  return (
    <div className="workspace-main-rail-grid">
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

              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="muted" className="tabular-nums">{tasks.length} visible</Badge>
                <Badge tone="muted" className="tabular-nums">{summary.total} total</Badge>
                {archivedTaskCount > 0 ? <Badge tone="muted" className="tabular-nums">{archivedTaskCount} archived</Badge> : null}
                {blockedCount > 0 ? <Badge tone="muted" className="tabular-nums">{blockedCount} blocked</Badge> : null}
                {inProgressCount > 0 ? <Badge tone="muted" className="tabular-nums">{inProgressCount} in progress</Badge> : null}
                {overdueCount > 0 ? <Badge tone="muted" className="tabular-nums">{overdueCount} overdue</Badge> : null}
                {dueSoonCount > 0 ? <Badge tone="muted" className="tabular-nums">{dueSoonCount} due soon</Badge> : null}
              </div>

              <div className="ml-auto">
                <TasksNewTaskButton testId="tasks-new-task" />
              </div>
            </div>

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

      <aside className="workspace-secondary-rail">
        <TasksNewTaskButton
          label="New task"
          testId="tasks-rail-new-task"
          className="w-full justify-center"
        />

        <Card label="Focus" title="Pinned tasks">
          {focusQueue.length === 0 ? (
            <CardContent>
              <p className="text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-[color:var(--ega-text-secondary)]">
                Pin tasks from the queue to build a deliberate focus order.
              </p>
            </CardContent>
          ) : (
            <ul className="rows">
              {focusQueue.slice(0, 5).map((task) => (
                <li key={task.id} className="row">
                  <span className="rank" aria-hidden="true">
                    {task.focus_rank}
                  </span>
                  <span className="row-main">
                    <span className="row-title">{task.title}</span>
                    <span className="row-meta">{task.projects?.name ?? "No project"}</span>
                  </span>
                  <FocusPinToggleForm
                    action={unpinTaskAction}
                    taskId={task.id}
                    returnTo={returnPath}
                    isPinned
                    compact
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <TaskSavedViewsPanel
          currentFilters={{
            status: activeStatus,
            projectId: activeProjectId,
            goalId: activeGoalId,
            dueFilter: parsed.activeDueFilter,
            sortValue: parsed.activeSort,
            activeTasks: savedViewDefinitionFilters.activeTasks,
            priorityValues: savedViewDefinitionFilters.priorityValues,
            estimateMinMinutes: savedViewDefinitionFilters.estimateMinMinutes,
            estimateMaxMinutes: savedViewDefinitionFilters.estimateMaxMinutes,
            dueWithinDays: savedViewDefinitionFilters.dueWithinDays,
          }}
          savedViews={savedViews}
          activeLayout={activeLayout}
          projectOptions={projects}
          goalOptions={goals.map((g) => ({ id: g.id, title: g.title }))}
          feedback={resolvedSavedViewFeedback}
        />

        <Card label="Create" title="Quick add task">
          <CardHeader className="!border-b-0 !pb-0">
            <CardDescription>
              The canonical task form, so every field stays available without a second
              creation flow.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {projects.length === 0 ? (
              <div className="flex flex-col gap-3">
                <p className="text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-[color:var(--ega-text-secondary)]">
                  No projects yet. Create one first to attach tasks to a project.
                </p>
                <Link
                  href="/tasks/projects/new"
                  className="btn-instrument flex h-8 items-center justify-center px-3 text-sm"
                >
                  Create project
                </Link>
              </div>
            ) : (
              <details className="action-overflow">
                <summary className="filter-pill w-full justify-center">
                  Open task form
                </summary>
                <div className="mt-3">
                  <CreateTaskForm
                    projects={projects}
                    goals={goals}
                    projectId={activeProjectId ?? undefined}
                    returnTo={returnPath}
                    calendarDefaults={calendarFormDefaults}
                  />
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
