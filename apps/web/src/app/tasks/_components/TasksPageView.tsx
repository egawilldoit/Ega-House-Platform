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
  updateTaskFieldDraftAction,
  bulkTaskFieldAction,
  bulkTaskArchiveAction,
  undoTaskOperationAction,
  updateTaskReminderAction,
  moveTaskOnBoardAction,
} from "@/app/tasks/actions";
import { startTimerAction } from "@/app/timer/actions";
import { BulkArchiveCompletedTasksForm } from "@/components/tasks/bulk-archive-completed-tasks-form";
import { TaskViewToolbar } from "@/components/tasks/view-toolbar/task-view-toolbar";
import { TasksNewTaskButton } from "@/components/tasks/tasks-new-task-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterPill } from "@/components/ui/filter-pill";
import { buildTaskListUrl } from "@/lib/task-list";
import { getTaskViewFromSavedView } from "@/lib/task-saved-views";
import { isTaskCompletedStatus } from "@/lib/task-domain";
import { formatDisplayCount } from "@/lib/presentation-format";
import { ListChecks } from "lucide-react";
import type { TasksPageModel } from "../_lib/tasks-page-model";
import { TasksListTable, type TaskListActions } from "./tasks-list-table";
import { TaskDrawerHost } from "@/components/tasks/drawer/task-drawer-host";
import { updateTaskFieldAction } from "@/app/tasks/actions";
import { TASK_SUBTASK_ACTIONS } from "@/lib/task-subtask-actions";
import { TASK_COMMENT_ACTIONS } from "@/lib/task-comment-actions";
import { KanbanBoard, type KanbanBulkActions, type KanbanCardActions } from "./kanban/kanban-board";

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

export function TasksPageView({
  model,
  ownerId = null,
  favouriteAction,
}: {
  model: TasksPageModel;
  ownerId?: string | null;
  favouriteAction?: (formData: FormData) => void | Promise<void>;
}) {
  const {
    parsed,
    projects,
    goals,
    tasks,
    taskTotalDurations,
    summary,
    savedViews,
    returnPath,
    taskUrlFilters,
    kanbanBoard,
    inProgressCount,
    blockedCount,
    overdueCount,
    dueSoonCount,
    selectedTask,
    selectedTaskId,
    selectedTaskError,
    selectedTaskSubtasks,
    subtaskCounts,
    selectedTaskActivity,
    selectedTaskActivityHasMore,
    groups,
    filteredTotal,
    loadedCount,
    truncated,
    selectedTaskComments,
    selectedTaskCommentMentions,
    selectedTaskCommentError,
  } = model;
  const { activeView, activeLayout } = parsed;
  const completedTaskIdsInScope = getArchivableCompletedTaskIds(tasks);  // Restore clears archived state only; it must never resurrect a completed
  // task as unfinished work.
  const showBulkArchive = activeView === "active" && completedTaskIdsInScope.length > 0;
  const taskUpdateError = parsed.taskUpdateError;
  const taskUpdateSuccess = parsed.taskUpdateSuccess;
  const taskUpdateTaskId = parsed.taskUpdateTaskId;

  const hasAnyTasks = summary.total > 0;
  const summaryParts = [
    `${formatDisplayCount(loadedCount)} shown`,
    `${formatDisplayCount(filteredTotal)} matching`,
    `${formatDisplayCount(summary.total)} total`,
  ];
  if (truncated) summaryParts.push("row limit reached");
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
    updateReminderAction: updateTaskReminderAction,
    cancelReminderAction: cancelTaskReminderAction,
    bulkFieldAction: bulkTaskFieldAction,
    bulkArchiveAction: bulkTaskArchiveAction,
    undoAction: undoTaskOperationAction,
  };

  const bulkArchiveControl = showBulkArchive ? (
    <BulkArchiveCompletedTasksForm
      action={archiveManyCompletedTasksAction}
      taskIds={completedTaskIdsInScope}
      returnTo={returnPath}
    />
  ) : null;

  const kanbanCardActions: KanbanCardActions = {
    updateAction: updateTaskInlineAction,
    updateEditorAction: updateTaskEditorAction,
    startTimerAction,
    pinAction: pinTaskAction,
    unpinAction: unpinTaskAction,
    archiveAction: archiveTaskAction,
    unarchiveAction: unarchiveTaskAction,
    deleteAction: deleteTaskAction,
    createReminderAction: createTaskReminderAction,
    updateReminderAction: updateTaskReminderAction,
    cancelReminderAction: cancelTaskReminderAction,
    projectOptions: projects,
    goalOptions: goals.map((goal) => ({
      id: goal.id,
      title: goal.title,
      projectId: goal.project_id,
    })),
    returnTo: returnPath,
  };

  const kanbanBulkActions: KanbanBulkActions = {
    bulkFieldAction: bulkTaskFieldAction,
    bulkArchiveAction: bulkTaskArchiveAction,
    undoAction: undoTaskOperationAction,
  };

  const kanbanHref = (boardOrder: "manual" | "priority" | null) =>
    buildTaskListUrl("/tasks", {
      ...taskUrlFilters,
      // Keep the active view (Current / Archived / All): the order links must
      // not silently switch scopes.
      view: activeView,
      layout: "kanban",
      boardOrder,
    });

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
            {/* Row 1 — scope selection: which tasks you are looking at, in which
                shape. Distinct from the data controls below. */}
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
                        density: parsed.activeDensity,
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
                  href={buildTaskListUrl("/tasks", {
                    ...taskUrlFilters,
                    view: activeView,
                    layout: "list",
                    density: parsed.activeDensity,
                  })}
                  label="List"
                  active={activeLayout === "list"}
                  ariaCurrent={activeLayout === "list" ? "page" : undefined}
                />
                <FilterPill
                  href={buildTaskListUrl("/tasks", {
                    ...taskUrlFilters,
                    view: activeView,
                    layout: "kanban",
                    density: parsed.activeDensity,
                  })}
                  label="Board"
                  active={activeLayout === "kanban"}
                  ariaCurrent={activeLayout === "kanban" ? "page" : undefined}
                />
              </div>

              <p
                className="ml-auto min-w-0 truncate text-[length:var(--text-meta)] tabular-nums text-[color:var(--ega-text-tertiary)]"
                data-testid="tasks-summary"
              >
                {summaryParts.join(" · ")}
              </p>
            </div>

            {/* Row 2 — data controls on the left, mutation actions on the right. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <TaskViewToolbar
                basePath="/tasks"
                view={parsed.view}
                activeLayout={activeLayout}
                activeDensity={parsed.activeDensity}
                activeView={activeView}
                activeBoardOrder={parsed.activeBoardOrder}
                projectOptions={projects}
                goalOptions={goals.map((goal) => ({ id: goal.id, title: goal.title }))}
                savedViews={savedViews.map((view) => {
                  const savedView = getTaskViewFromSavedView({
                    definitionJson: view.definition_json,
                    status: view.status,
                    projectId: view.project_id,
                    goalId: view.goal_id,
                    dueFilter: view.due_filter,
                    sortValue: view.sort_value,
                  });
                  return {
                    id: view.id,
                    name: view.name,
                    isBuiltIn: view.is_default,
                    href: buildTaskListUrl("/tasks", {
                      filters: savedView.filters,
                      group: savedView.groupBy,
                      q: savedView.search,
                      sortKey: savedView.sort.key,
                      sortDirection: savedView.sort.direction,
                      activeTasks: savedView.activeOnly,
                      view: activeView,
                      layout: activeLayout,
                      density: parsed.activeDensity,
                    }),
                  };
                })}
                feedback={parsed.savedViewFeedback}
              />

              <div className="ml-auto flex items-center gap-2">
                {bulkArchiveControl}
                <TasksNewTaskButton testId="tasks-new-task" />
              </div>
            </div>
          </div>

          {taskUpdateSuccess ? (
            <p className="feedback-block m-[18px]">{taskUpdateSuccess}</p>
          ) : null}

          {activeLayout === "kanban" ? (
            tasks.length === 0 ? (
              emptyState
            ) : (
              <KanbanBoard
                columns={kanbanBoard.columns}
                tasksByStatus={kanbanBoard.tasksByStatus}
                boardOrder={parsed.activeBoardOrder}
                activeView={activeView}
                ownerId={ownerId}
                returnTo={returnPath}
                manualHref={kanbanHref("manual")}
                priorityHref={kanbanHref("priority")}
                defaultOrderHref={kanbanHref(null)}
                moveAction={moveTaskOnBoardAction}
                bulkActions={kanbanBulkActions}
                cardProps={kanbanCardActions}
                taskTotalDurations={taskTotalDurations}
                subtaskCounts={subtaskCounts}
                taskUpdateTaskId={taskUpdateTaskId}
                taskUpdateError={taskUpdateError}
              />
            )
          ) : tasks.length === 0 ? (
            emptyState
          ) : parsed.view.groupBy === "none" ? (
            <TasksListTable
              tasks={tasks}
              taskTotalDurations={taskTotalDurations}
              subtaskCounts={subtaskCounts}
              returnTo={returnPath}
              taskUpdateTaskId={taskUpdateTaskId}
              taskUpdateError={taskUpdateError}
              projectOptions={projects}
              goalOptions={goals.map((goal) => ({
                id: goal.id,
                title: goal.title,
                projectId: goal.project_id,
              }))}
              density={parsed.activeDensity}
              actions={taskListActions}
            />
          ) : (
            <div className="flex flex-col gap-2 p-[18px]">
              {groups.map((group) => (
                <section
                  key={group.key}
                  aria-labelledby={`task-group-${parsed.view.groupBy}-${group.key}`}
                  className="rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[var(--ega-surface)]"
                >
                  <details open>
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-focus-outline)]">
                      <h2
                        id={`task-group-${parsed.view.groupBy}-${group.key}`}
                        className="text-[length:var(--text-meta-lg)] font-semibold text-[color:var(--ega-text)]"
                      >
                        {group.label}
                      </h2>
                      <Badge tone="muted">
                        {group.count} task{group.count === 1 ? "" : "s"}
                      </Badge>
                    </summary>
                    {group.tasks.length > 0 ? (
                      <TasksListTable
                        tasks={group.tasks}
                        taskTotalDurations={taskTotalDurations}
                        subtaskCounts={subtaskCounts}
                        returnTo={returnPath}
                        taskUpdateTaskId={taskUpdateTaskId}
                        taskUpdateError={taskUpdateError}
                        projectOptions={projects}
                        goalOptions={goals.map((goal) => ({
                          id: goal.id,
                          title: goal.title,
                          projectId: goal.project_id,
                        }))}
                        density={parsed.activeDensity}
                        actions={taskListActions}
                      />
                    ) : (
                      <p className="border-t border-[var(--ega-divider)] px-3 py-4 text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-tertiary)]">
                        No tasks in this group yet.
                      </p>
                    )}
                  </details>
                </section>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Only mount the client drawer when a task is selected, so the closed
          state costs no client hook and stays server-rendered. */}
      {selectedTaskId ? (
        <TaskDrawerHost
          task={selectedTask}
          loadFailed={selectedTaskError}
          updateFieldAction={updateTaskFieldAction}
          updateDraftAction={updateTaskFieldDraftAction}
          ownerId={ownerId}
          subtasks={selectedTaskSubtasks}
          activity={selectedTaskActivity}
          activityHasMore={selectedTaskActivityHasMore}
          comments={selectedTaskComments.comments}
          commentMentions={selectedTaskCommentMentions}
          commentsError={selectedTaskCommentError}
          commentActions={TASK_COMMENT_ACTIONS}
          isFavourite={Boolean(model.selectedTaskIsFavourite)}
          favouriteAction={favouriteAction}
          subtaskActions={TASK_SUBTASK_ACTIONS}
          updateError={taskUpdateTaskId === selectedTaskId ? taskUpdateError : null}
          updateSuccess={taskUpdateTaskId === selectedTaskId ? taskUpdateSuccess : null}
        />
      ) : null}
    </div>
  );
}
