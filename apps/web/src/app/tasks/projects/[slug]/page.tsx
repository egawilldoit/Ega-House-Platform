import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { CalendarDays } from "lucide-react";

import {
  buildProjectProgress,
  createAuthenticatedActor,
  getProjectIdentityReadModel,
  type ProjectGoalRecord,
  type ProjectIdentityReadModel,
  type ProjectRecord,
} from "@ega/application";
import { SupabaseProjectsRepository } from "@ega/data-access";

import { TaskDrawerHost } from "@/components/tasks/drawer/task-drawer-host";
import { buildTaskFilterReturnPath } from "@/components/tasks/task-filter-url";
import { TasksWorkspaceShell } from "@/components/tasks/tasks-workspace-shell";
import {
  addTaskDependencyAction,
  deleteTaskAction,
  pinTaskAction,
  removeTaskDependencyAction,
  unpinTaskAction,
  updateTaskFieldAction,
  updateTaskFieldDraftAction,
  updateTaskInlineAction,
} from "@/app/tasks/actions";
import {
  getCalendarIntegrationSettings,
  getCalendarTaskFormDefaults,
} from "@/lib/services/calendar-settings-service";
import { getCurrentUser, requireAuthenticatedUser } from "@/lib/services/auth-service";
import { getWebTimeContext, type WebTimeContext } from "@/lib/services/time-context-service";
import { createClient } from "@/lib/supabase/server";
import { sortFocusQueueTasks } from "@/lib/focus-queue";
import {
  DEFAULT_TASK_DUE_FILTER,
  DEFAULT_TASK_SORT,
  applyTaskListQuery,
  buildTaskListUrl,
  isTaskDueFilter,
  isTaskSortValue,
  type TaskDueFilter,
  type TaskSortValue,
} from "@/lib/task-list";
import { buildProjectTimeSummary, selectProjectComingUpTasks } from "@/lib/project-overview";
import { isProjectArchivedStatus, normalizeProjectViewFilter } from "@/lib/project-archive";
import { getTaskSessionSummaryMap } from "@/lib/task-session";
import { buildTaskDrawerLink } from "@/lib/task-drawer-url";
import { listTaskSubtasks } from "@/lib/services/subtask-service";
import { getProjectTaskActivity, getTaskActivity } from "@/lib/services/task-activity-service";
import { getTaskCommentThread } from "@/lib/services/task-comment-service";
import { isFavorite } from "@/lib/services/favorite-service";
import { toggleFavoriteAction } from "@/app/favorites/actions";
import { TASK_SUBTASK_ACTIONS } from "@/lib/task-subtask-actions";
import { TASK_COMMENT_ACTIONS } from "@/lib/task-comment-actions";
import {
  getTaskDrawerDetail,
  getTaskRecurrencesForTasks,
  getTaskRemindersForTasks,
  type TaskRecord,
} from "@/lib/services/task-service";
import { isTaskPriority, isTaskStatus } from "@/lib/task-domain";
import { getTodayIsoDateForTimezone, getWeekWindowViaTimeContext } from "@/lib/review-week";

import { ProjectBoard } from "./_components/project-board";
import { ProjectOverview } from "./_components/project-overview";
import { ProjectTabNav, normalizeProjectTab } from "./_components/project-tab-nav";
import { ProjectTaskHashLink } from "./_components/project-task-hash-link";
import { ProjectTaskList } from "./_components/project-task-list";

type ProjectDetailPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    view?: string;
    tab?: string;
    status?: string;
    priority?: string;
    due?: string;
    sort?: string;
    taskUpdateError?: string;
    taskUpdateSuccess?: string;
    taskUpdateTaskId?: string;
    projectUpdateError?: string;
    projectUpdateProjectId?: string;
    projectUpdateField?: string;
    task?: string;
    taskMode?: string;
  }>;
};

const getProjectIdentity = cache(async (slug: string) => {
  const supabase = await createClient();
  const user = await requireAuthenticatedUser({ supabase });
  const actor = createAuthenticatedActor(user.id);
  const repository = new SupabaseProjectsRepository(supabase);
  const identityResult = await getProjectIdentityReadModel(actor, repository, slug.trim());

  if (!identityResult.ok) {
    throw new Error(identityResult.errorMessage);
  }

  return identityResult.data;
});

function resolveWeekWindow(timeContext: WebTimeContext | null) {
  const today = timeContext?.localDate ?? getTodayIsoDateForTimezone("UTC");
  const timezone = timeContext?.timezone ?? "UTC";
  const week = getWeekWindowViaTimeContext(timezone, today);

  if (week) {
    return {
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      startIso: week.startIso,
      endIso: week.endExclusiveIso,
    };
  }

  const startMs = Date.parse(`${today}T00:00:00.000Z`);
  return {
    weekStart: today,
    weekEnd: today,
    startIso: `${today}T00:00:00.000Z`,
    endIso: new Date(startMs + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

async function getProjectDetail(
  projectIdentity: ProjectIdentityReadModel,
  timeContext: WebTimeContext | null,
) {
  const supabase = await createClient();
  const project = projectIdentity.project;
  const tasksResult = await supabase
    .from("tasks")
    .select(
      "id, title, description, blocked_reason, status, priority, due_date, planned_for_date, scheduled_start_at, scheduled_end_at, calendar_sync_enabled, calendar_reminder_minutes, estimate_minutes, updated_at, completed_at, project_id, goal_id, focus_rank, archived_at, archived_by, goals(title), projects(name, slug)",
    )
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false });

  if (tasksResult.error) {
    throw new Error(`Failed to load project tasks: ${tasksResult.error.message}`);
  }

  const taskRows = (tasksResult.data ?? []) as Omit<
    TaskRecord,
    "task_reminders" | "task_recurrences"
  >[];
  const taskIds = taskRows.map((task) => task.id);
  const [taskRemindersByTaskId, taskRecurrencesByTaskId] = await Promise.all([
    getTaskRemindersForTasks(supabase, taskIds),
    getTaskRecurrencesForTasks(supabase, taskIds),
  ]);
  const allTasks: TaskRecord[] = taskRows.map((task) => ({
    ...task,
    task_reminders: taskRemindersByTaskId[task.id] ?? [],
    task_recurrences: taskRecurrencesByTaskId[task.id] ?? [],
  }));
  const activeTasks = allTasks.filter((task) => task.archived_at === null);
  const archivedTaskCount = allTasks.length - activeTasks.length;
  const today = timeContext?.localDate ?? getTodayIsoDateForTimezone("UTC");
  const timezone = timeContext?.timezone ?? "UTC";
  const weekWindow = resolveWeekWindow(timeContext);
  const nowIso = new Date().toISOString();
  const [{ sessions, byTask }, projectActivity] = await Promise.all([
    getTaskSessionSummaryMap(supabase, taskIds, weekWindow, nowIso),
    getProjectTaskActivity(taskIds, { limit: 5 }),
  ]);
  const taskTotalDurations = Object.fromEntries(
    Object.entries(byTask).map(([taskId, summary]) => [taskId, summary.totalSeconds]),
  );

  return {
    project: project as ProjectRecord,
    goals: projectIdentity.goals as ProjectGoalRecord[],
    tasks: allTasks,
    activeTasks,
    archivedTaskCount,
    progress: buildProjectProgress(activeTasks),
    comingUp: selectProjectComingUpTasks(activeTasks, { today, timezone, limit: 6 }),
    timeSummary: buildProjectTimeSummary(allTasks, sessions, weekWindow, nowIso),
    taskTotalDurations,
    projectActivity,
  };
}

export async function generateMetadata({ params }: ProjectDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const projectIdentity = await getProjectIdentity(slug);

  if (!projectIdentity) {
    return {
      title: "Project Not Found | Tasks",
    };
  }

  return {
    title: `${projectIdentity.project.name} | Projects | Tasks`,
    description:
      projectIdentity.project.description?.trim() ||
      `Task workspace for ${projectIdentity.project.name}.`,
  };
}

export default async function ProjectDetailPage({
  params,
  searchParams,
}: ProjectDetailPageProps) {
  const [{ slug }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const [projectIdentity, calendarSettingsResult, timeContext, currentUser] = await Promise.all([
    getProjectIdentity(slug),
    getCalendarIntegrationSettings(),
    getWebTimeContext().catch(() => null),
    getCurrentUser(),
  ]);

  if (!projectIdentity) {
    notFound();
  }

  const projectDetail = await getProjectDetail(projectIdentity, timeContext);
  const {
    project,
    goals,
    tasks: allTasks,
    activeTasks,
    archivedTaskCount,
    progress,
    comingUp,
    timeSummary,
    taskTotalDurations,
    projectActivity,
  } = projectDetail;

  const activeView = normalizeProjectViewFilter(resolvedSearchParams.view);
  const activeTab = normalizeProjectTab(resolvedSearchParams.tab);
  const activeStatus =
    resolvedSearchParams.status && isTaskStatus(resolvedSearchParams.status)
      ? resolvedSearchParams.status
      : null;
  const activePriority =
    resolvedSearchParams.priority && isTaskPriority(resolvedSearchParams.priority)
      ? resolvedSearchParams.priority
      : null;
  const activeDueFilter: TaskDueFilter =
    resolvedSearchParams.due && isTaskDueFilter(resolvedSearchParams.due)
      ? resolvedSearchParams.due
      : DEFAULT_TASK_DUE_FILTER;
  const activeSort: TaskSortValue =
    resolvedSearchParams.sort && isTaskSortValue(resolvedSearchParams.sort)
      ? resolvedSearchParams.sort
      : DEFAULT_TASK_SORT;
  const taskUpdateError = resolvedSearchParams.taskUpdateError?.slice(0, 180) ?? null;
  const taskUpdateSuccess = resolvedSearchParams.taskUpdateSuccess?.slice(0, 180) ?? null;
  const taskUpdateTaskId = resolvedSearchParams.taskUpdateTaskId ?? null;
  const projectUpdateError = resolvedSearchParams.projectUpdateError?.slice(0, 180) ?? null;
  const projectUpdateProjectId = resolvedSearchParams.projectUpdateProjectId ?? null;
  const projectUpdateField = resolvedSearchParams.projectUpdateField ?? null;
  const selectedTaskId = resolvedSearchParams.task?.slice(0, 80) ?? null;

  const calendarFormDefaults = getCalendarTaskFormDefaults(calendarSettingsResult.data);
  const projectIsArchived = isProjectArchivedStatus(project.status);
  const baseProjectsHref =
    activeView === "active" ? "/tasks/projects" : `/tasks/projects?view=${activeView}`;
  const projectPath = `/tasks/projects/${project.slug}`;
  // The project calendar is the canonical Tasks calendar with the project
  // filter applied, so there is exactly one calendar range read and one drag
  // reschedule owner rather than a second project-only implementation.
  const projectCalendarHref = buildTaskListUrl("/tasks", {
    project: project.id,
    status: activeStatus,
    priority: activePriority,
    due: activeDueFilter,
    sort: activeSort,
    view: activeView,
    layout: "calendar",
    cal: "month",
  });
  const deleteHref =
    activeView === "active" ? `${projectPath}/delete` : `${projectPath}/delete?view=${activeView}`;

  let returnTo = buildTaskFilterReturnPath(projectPath, {
    status: activeStatus,
    priority: activePriority,
    due: activeDueFilter,
    sort: activeSort,
  });

  if (activeView !== "active") {
    const target = new URL(returnTo, "https://egawilldoit.online");
    target.searchParams.set("view", activeView);
    returnTo = `${target.pathname}${target.search}`;
  }
  if (activeTab !== "overview") {
    const target = new URL(returnTo, "https://egawilldoit.online");
    target.searchParams.set("tab", activeTab);
    returnTo = `${target.pathname}${target.search}`;
  }
  if (selectedTaskId) {
    // The drawer is the selected-task host for this page; the return path keeps
    // the project filters and the selection so a picker save stays here.
    returnTo = buildTaskDrawerLink(returnTo, selectedTaskId);
  }

  const tabSearchParams = new URLSearchParams();
  for (const key of ["view", "status", "priority", "due", "sort", "task", "taskMode"] as const) {
    const value = resolvedSearchParams[key];
    if (value) tabSearchParams.set(key, value);
  }

  const selectedTaskResult = selectedTaskId ? await getTaskDrawerDetail(selectedTaskId) : null;
  const selectedTask = selectedTaskResult?.kind === "found" ? selectedTaskResult.task : null;
  const selectedTaskSubtasks = selectedTaskId
    ? (await listTaskSubtasks(selectedTaskId)).data ?? []
    : [];
  const selectedTaskActivityPage = selectedTaskId
    ? await getTaskActivity(selectedTaskId, { limit: 8 })
    : { items: [], hasMore: false };
  const selectedTaskActivity = selectedTaskActivityPage.items;
  const selectedTaskComments = selectedTaskId
    ? await getTaskCommentThread(selectedTaskId)
    : { comments: [], mentionCandidates: [], errorMessage: null };
  const projectIsFavourite = await isFavorite("project", project.id);
  const selectedTaskIsFavourite = selectedTaskId
    ? await isFavorite("task", selectedTaskId)
    : false;

  const filteredTasks = applyTaskListQuery(
    activeTasks.filter((task) => {
      if (activeStatus && task.status !== activeStatus) {
        return false;
      }

      if (activePriority && task.priority !== activePriority) {
        return false;
      }

      return true;
    }),
    {
      dueFilter: activeDueFilter,
      sortValue: activeSort,
      today: timeContext?.localDate,
    },
  );
  const focusQueue = sortFocusQueueTasks(filteredTasks);
  const taskTitles = new Map(allTasks.map((task) => [task.id, task.title]));
  const hasActiveTaskFilters =
    activeStatus !== null ||
    activePriority !== null ||
    activeDueFilter !== DEFAULT_TASK_DUE_FILTER ||
    activeSort !== DEFAULT_TASK_SORT;

  const statusError =
    projectUpdateProjectId === project.id && projectUpdateField === "status"
      ? projectUpdateError
      : null;
  const archiveError =
    projectUpdateProjectId === project.id && projectUpdateField === "archive"
      ? projectUpdateError
      : null;

  return (
    <TasksWorkspaceShell
      title={project.name}
      description={
        project.description?.trim() ||
        "Project workspace for goals, tasks, and execution controls."
      }
      actions={
        <div className="flex items-center gap-2">
          <form action={toggleFavoriteAction}>
            <input type="hidden" name="kind" value="project" />
            <input type="hidden" name="entityId" value={project.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <button
              type="submit"
              aria-pressed={projectIsFavourite}
              className="btn-instrument btn-instrument-muted flex h-8 items-center gap-2 px-4"
            >
              {projectIsFavourite ? "★ Favourited" : "☆ Favourite"}
            </button>
          </form>
          <Link
            href={projectCalendarHref}
            className="btn-instrument btn-instrument-muted flex h-8 items-center gap-2 px-4"
          >
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            Calendar
          </Link>
          <Link
            href={baseProjectsHref}
            className="btn-instrument btn-instrument-muted flex h-8 items-center px-4"
          >
            Back to Projects
          </Link>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <ProjectTaskHashLink activeTab={activeTab} />
        <ProjectTabNav
          activeTab={activeTab}
          basePath={projectPath}
          search={tabSearchParams.toString()}
          projectName={project.name}
        />

        {activeTab === "overview" ? (
          <section
            role="tabpanel"
            id="project-panel-overview"
            aria-labelledby="project-tab-overview"
            tabIndex={-1}
          >
            <ProjectOverview
              project={project}
              goals={goals}
              progress={progress}
              comingUp={comingUp}
              timeSummary={timeSummary}
              activities={projectActivity}
              taskTitles={taskTitles}
              archivedTaskCount={archivedTaskCount}
              projectIsArchived={projectIsArchived}
              timezone={timeContext?.timezone ?? "UTC"}
              returnTo={returnTo}
              deleteHref={deleteHref}
              statusError={statusError}
              archiveError={archiveError}
            />
          </section>
        ) : null}

        {activeTab === "board" ? (
          <section
            role="tabpanel"
            id="project-panel-board"
            aria-labelledby="project-tab-board"
            tabIndex={-1}
          >
            <ProjectBoard
              tasks={filteredTasks}
              activeStatus={activeStatus}
              returnTo={returnTo}
              taskTotalDurations={taskTotalDurations}
              projectOptions={[{ id: project.id, name: project.name }]}
              goalOptions={goals.map((goal) => ({
                id: goal.id,
                title: goal.title,
                projectId: goal.projectId,
              }))}
              actions={{
                updateAction: updateTaskInlineAction,
                pinAction: pinTaskAction,
                unpinAction: unpinTaskAction,
                deleteAction: deleteTaskAction,
              }}
              errorForTask={(taskId) =>
                taskUpdateTaskId === taskId ? taskUpdateError : null
              }
              updateSuccess={taskUpdateSuccess}
              updateError={taskUpdateTaskId ? null : taskUpdateError}
              hasActiveFilters={hasActiveTaskFilters}
              clearFiltersHref={`${projectPath}?tab=board`}
            />
          </section>
        ) : null}

        {activeTab === "list" ? (
          <section
            role="tabpanel"
            id="project-panel-list"
            aria-labelledby="project-tab-list"
            tabIndex={-1}
          >
            <ProjectTaskList
              project={project}
              goals={goals}
              tasks={filteredTasks}
              activeStatus={activeStatus}
              activePriority={activePriority}
              activeDueFilter={activeDueFilter}
              activeSort={activeSort}
              activeView={activeView}
              taskFilterBasePath={projectPath}
              returnTo={returnTo}
              taskUpdateError={taskUpdateError}
              taskUpdateSuccess={taskUpdateSuccess}
              taskUpdateTaskId={taskUpdateTaskId}
              focusQueue={focusQueue}
              projectIsArchived={projectIsArchived}
              archivedTaskCount={archivedTaskCount}
              calendarFormDefaults={calendarFormDefaults}
            />
          </section>
        ) : null}
      </div>

      {selectedTaskId ? (
        <TaskDrawerHost
          task={selectedTask}
          loadFailed={selectedTaskResult?.kind === "error"}
          updateFieldAction={updateTaskFieldAction}
          updateDraftAction={updateTaskFieldDraftAction}
          ownerId={currentUser?.id ?? null}
          subtasks={selectedTaskSubtasks}
          activity={selectedTaskActivity}
          activityHasMore={selectedTaskActivityPage.hasMore}
          comments={selectedTaskComments.comments}
          commentMentions={selectedTaskComments.mentionCandidates}
          commentsError={selectedTaskComments.errorMessage}
          commentActions={TASK_COMMENT_ACTIONS}
          isFavourite={selectedTaskIsFavourite}
          favouriteAction={toggleFavoriteAction}
          subtaskActions={TASK_SUBTASK_ACTIONS}
          updateError={taskUpdateTaskId === selectedTaskId ? taskUpdateError : null}
          updateSuccess={taskUpdateTaskId === selectedTaskId ? taskUpdateSuccess : null}
          addDependencyAction={addTaskDependencyAction}
          removeDependencyAction={removeTaskDependencyAction}
        />
      ) : null}
    </TasksWorkspaceShell>
  );
}
