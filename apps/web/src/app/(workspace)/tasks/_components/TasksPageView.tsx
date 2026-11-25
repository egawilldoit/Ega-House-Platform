import Link from "next/link";
import { ListChecks } from "lucide-react";

import {
  cancelTaskReminderAction,
  createTaskReminderAction,
  addTaskDependencyAction,
  removeTaskDependencyAction,
  unarchiveTaskAction,
  updateTaskInlineAction,
  updateTaskFieldAction,
  updateTaskFieldDraftAction,
  bulkTaskFieldAction,
  bulkTaskArchiveAction,
} from "@/app/(workspace)/tasks/actions";
import { TasksNewTaskButton } from "@/components/tasks/tasks-new-task-button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterPill } from "@/components/ui/filter-pill";
import { buildTaskListUrl } from "@/lib/task-list";
import { formatDisplayCount } from "@/lib/presentation-format";
import type { TasksPageModel } from "../_lib/tasks-page-model";
import { TaskDrawerHost } from "@/components/tasks/drawer/task-drawer-host";
import { TASK_SUBTASK_ACTIONS } from "@/lib/task-subtask-actions";
import { TASK_COMMENT_ACTIONS } from "@/lib/task-comment-actions";
import { TaskFilterBar } from "./task-filter-bar";
import { TaskList } from "./task-list";
import { TaskInboxPanel } from "./task-inbox-panel";
import { TaskCalendarSyncPanel } from "@/components/tasks/task-calendar-sync-panel";
import type { CalendarSyncStatusView } from "@ega/application/calendar-sync/service";

/**
 * Lean Tasks workbench.
 *
 * Three scope tabs (Active / Inbox / Archived), one four-control filter bar and
 * one semantic task list. Every edit entry point opens the canonical
 * TaskDrawerHost; the list itself only completes, selects and archives.
 */
export function TasksPageView({
  model,
  ownerId = null,
  favouriteAction,
  calendarSyncStatus,
  calendarOAuthNotice,
}: {
  model: TasksPageModel;
  ownerId?: string | null;
  favouriteAction?: (formData: FormData) => void | Promise<void>;
  calendarSyncStatus?: CalendarSyncStatusView;
  calendarOAuthNotice?: { tone: "success" | "error"; message: string } | null;
}) {
  const {
    parsed,
    projects,
    tasks,
    summary,
    returnPath,
    taskUrlFilters,
    selectedTask,
    selectedTaskId,
    selectedTaskError,
    selectedTaskSubtasks,
    selectedTaskAttachments,
    selectedTaskActivity,
    selectedTaskActivityHasMore,
    selectedTaskComments,
    selectedTaskCommentMentions,
    selectedTaskCommentError,
    selectedTaskPlanning,
    inboxIdeas,
    inboxIdeasError,
    inboxProjects,
  } = model;
  const { activeTab } = parsed;
  const taskUpdateError = parsed.taskUpdateError;
  const taskUpdateSuccess = parsed.taskUpdateSuccess;
  const taskUpdateTaskId = parsed.taskUpdateTaskId;

  const tabHref = (tab: "active" | "inbox" | "archived") => {
    if (tab === "inbox") return "/tasks?tab=inbox";
    return buildTaskListUrl("/tasks", {
      ...taskUrlFilters,
      view: tab,
    });
  };

  const hasAnyTasks = summary.total > 0;

  const emptyState = (
    <EmptyState
      icon={ListChecks}
      title={
        activeTab === "archived"
          ? "No archived tasks"
          : hasAnyTasks
            ? "No tasks match current filters"
            : "No tasks yet"
      }
      description={
        activeTab === "archived"
          ? "Tasks you archive from the Active list remain here and can be restored."
          : hasAnyTasks
            ? "Reset one or more filters to bring the execution queue back into view."
            : "Create a task to start the execution queue."
      }
      action={
        hasAnyTasks && activeTab === "active" ? (
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
      {calendarSyncStatus && activeTab === "active" ? (
        <TaskCalendarSyncPanel initialStatus={calendarSyncStatus} />
      ) : null}

      {calendarOAuthNotice ? (
        <p
          className={calendarOAuthNotice.tone === "error" ? "feedback-block" : "feedback-block"}
          role={calendarOAuthNotice.tone === "error" ? "alert" : "status"}
        >
          {calendarOAuthNotice.message}
        </p>
      ) : null}

      <Card clip>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--ega-divider)] px-[18px] py-3">
          <div
            className="flex flex-wrap items-center gap-1.5"
            aria-label="Task workbench tabs"
          >
            {(
              [
                { value: "active", label: "Active" },
                { value: "inbox", label: "Inbox" },
                { value: "archived", label: "Archived" },
              ] as const
            ).map((tab) => (
              <FilterPill
                key={tab.value}
                href={tabHref(tab.value)}
                label={tab.label}
                active={activeTab === tab.value}
                ariaCurrent={activeTab === tab.value ? "page" : undefined}
              />
            ))}
          </div>

          <p
            className="min-w-0 truncate text-[length:var(--text-meta)] tabular-nums text-[color:var(--ega-text-tertiary)]"
            data-testid="tasks-summary"
          >
            {activeTab === "inbox"
              ? `${formatDisplayCount(inboxIdeas.length)} captured`
              : `${formatDisplayCount(summary.active)} active · ${formatDisplayCount(
                  model.inProgressCount,
                )} in progress · ${formatDisplayCount(model.overdueCount)} overdue`}
          </p>

          <div className="ml-auto flex items-center gap-2">
            <TasksNewTaskButton testId="tasks-new-task" />
          </div>
        </div>

        {taskUpdateSuccess ? (
          <p className="feedback-block m-[18px]">{taskUpdateSuccess}</p>
        ) : null}

        {activeTab === "inbox" ? (
          <TaskInboxPanel
            key={ownerId ?? "anonymous"}
            ideas={inboxIdeas}
            projects={inboxProjects}
            ownerId={ownerId}
            loadError={inboxIdeasError}
          />
        ) : (
          <>
            <TaskFilterBar
              view={activeTab === "archived" ? "archived" : "active"}
              search={parsed.view.search}
              status={parsed.activeStatus}
              project={parsed.projectParam}
              due={parsed.activeDueFilter}
              projects={projects}
              returnTo={activeTab === "archived" ? tabHref("archived") : "/tasks"}
            />

            {tasks.length === 0 ? (
              emptyState
            ) : (
              <TaskList
                key={activeTab}
                tasks={tasks}
                returnTo={returnPath}
                view={activeTab === "archived" ? "archived" : "active"}
                bulkActions={{
                  bulkFieldAction: bulkTaskFieldAction,
                  bulkArchiveAction: bulkTaskArchiveAction,
                }}
                unarchiveAction={unarchiveTaskAction}
                taskUpdateTaskId={taskUpdateTaskId}
                taskUpdateError={taskUpdateError}
              />
            )}
          </>
        )}
      </Card>

      {selectedTaskId ? (
        <TaskDrawerHost
          task={selectedTask}
          loadFailed={selectedTaskError}
          updateFieldAction={updateTaskFieldAction}
          updateDraftAction={updateTaskFieldDraftAction}
          ownerId={ownerId}
          subtasks={selectedTaskSubtasks}
          attachments={selectedTaskAttachments.data}
          attachmentsError={selectedTaskAttachments.errorMessage}
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
          addDependencyAction={addTaskDependencyAction}
          removeDependencyAction={removeTaskDependencyAction}
          planning={selectedTaskPlanning}
          projectOptions={selectedTaskPlanning?.projectOptions ?? projects}
          updateInlineAction={updateTaskInlineAction}
          createReminderAction={createTaskReminderAction}
          cancelReminderAction={cancelTaskReminderAction}
        />
      ) : null}
    </div>
  );
}
