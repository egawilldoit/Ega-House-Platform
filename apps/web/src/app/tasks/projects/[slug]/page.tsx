import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";

import {
  createAuthenticatedActor,
  getProjectIdentityReadModel,
  type ProjectGoalRecord,
  type ProjectRecord,
} from "@ega/application";
import { SupabaseProjectsRepository } from "@ega/data-access";

import { CreateTaskForm } from "@/app/tasks/create-task-form";
import {
  cancelTaskReminderAction,
  createTaskReminderAction,
  deleteTaskAction,
  pinTaskAction,
  unpinTaskAction,
  updateTaskInlineAction,
} from "@/app/tasks/actions";
import {
  archiveProjectAction,
  unarchiveProjectAction,
  updateProjectStatusAction,
} from "@/app/tasks/projects/actions";
import { InlineProjectStatusForm } from "@/components/projects/inline-project-status-form";
import { FocusPinToggleForm } from "@/components/tasks/focus-pin-toggle-form";
import { TaskDueDateLabel } from "@/components/tasks/task-due-date-label";
import { InlineTaskUpdateForm } from "@/components/tasks/inline-task-update-form";
import { TaskReminderPanel } from "@/components/tasks/task-reminder-panel";
import { TaskFilterControls } from "@/components/tasks/task-filter-controls";
import { buildTaskFilterReturnPath } from "@/components/tasks/task-filter-url";
import { TasksWorkspaceShell } from "@/components/tasks/tasks-workspace-shell";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Metric } from "@/components/ui/metric";
import {
  isProjectArchivedStatus,
  normalizeProjectViewFilter,
} from "@/lib/project-archive";
import { requireAuthenticatedUser } from "@/lib/services/auth-service";
import { createClient } from "@/lib/supabase/server";
import { sortFocusQueueTasks } from "@/lib/focus-queue";
import {
  DEFAULT_TASK_DUE_FILTER,
  DEFAULT_TASK_SORT,
  applyTaskListQuery,
  isTaskDueFilter,
  isTaskSortValue,
  type TaskDueFilter,
  type TaskSortValue,
} from "@/lib/task-list";
import { formatDurationLabel, getTaskTotalDurationMap } from "@/lib/task-session";
import { formatTaskEstimate } from "@/lib/task-estimate";
import { formatTaskRecurrenceRule } from "@/lib/task-recurrence";
import { formatTimerDateTime } from "@/lib/timer-domain";
import {
  getTaskRecurrencesForTasks,
  getTaskRemindersForTasks,
} from "@/lib/services/task-service";
import {
  getCalendarIntegrationSettings,
  getCalendarTaskFormDefaults,
} from "@/lib/services/calendar-settings-service";
import {
  TASK_STATUS_VALUES,
  formatTaskToken,
  getTaskStatusTone,
  isTaskPriority,
  isTaskStatus,
} from "@/lib/task-domain";
import type { Tables } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

type TaskRow = Pick<
  Tables<"tasks">,
  | "id"
  | "title"
  | "description"
  | "blocked_reason"
  | "status"
  | "priority"
  | "due_date"
  | "scheduled_start_at"
  | "scheduled_end_at"
  | "calendar_sync_enabled"
  | "calendar_reminder_minutes"
  | "estimate_minutes"
  | "updated_at"
  | "goal_id"
  | "focus_rank"
> & {
  goals: Pick<Tables<"goals">, "title"> | null;
  task_reminders: Awaited<ReturnType<typeof getTaskRemindersForTasks>>[string];
  task_recurrences: Awaited<ReturnType<typeof getTaskRecurrencesForTasks>>[string];
};

type ProjectDetailPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    view?: string;
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
  }>;
};

async function getProjectDetail(slug: string) {
  const supabase = await createClient();
  const user = await requireAuthenticatedUser({ supabase });
  const actor = createAuthenticatedActor(user.id);
  const repository = new SupabaseProjectsRepository(supabase);

  const identityResult = await getProjectIdentityReadModel(actor, repository, slug);

  if (!identityResult.ok) {
    throw new Error(identityResult.errorMessage);
  }

  const projectIdentity = identityResult.data;

  if (!projectIdentity) {
    return null;
  }

  const project = projectIdentity.project;
  const goals = projectIdentity.goals;

  const tasksResult = await supabase
    .from("tasks")
    .select(
      "id, title, description, blocked_reason, status, priority, due_date, scheduled_start_at, scheduled_end_at, calendar_sync_enabled, calendar_reminder_minutes, estimate_minutes, updated_at, goal_id, focus_rank, goals(title)",
    )
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false });

  if (tasksResult.error) {
    throw new Error(`Failed to load project tasks: ${tasksResult.error.message}`);
  }

  const taskRows = (tasksResult.data ?? []) as Omit<
    TaskRow,
    "task_reminders" | "task_recurrences"
  >[];
  const taskIds = taskRows.map((task) => task.id);
  const [taskRemindersByTaskId, taskRecurrencesByTaskId] = await Promise.all([
    getTaskRemindersForTasks(supabase, taskIds),
    getTaskRecurrencesForTasks(supabase, taskIds),
  ]);
  const allTasks = taskRows.map((task) => ({
    ...task,
    task_reminders: taskRemindersByTaskId[task.id] ?? [],
    task_recurrences: taskRecurrencesByTaskId[task.id] ?? [],
  }));
  const statusCounts = TASK_STATUS_VALUES.map((status) => ({
    status,
    count: allTasks.filter((task) => task.status === status).length,
  })).filter((entry) => entry.count > 0);

  const taskTotalDurations = await getTaskTotalDurationMap(
    supabase,
    allTasks.map((task) => task.id),
  );

  return {
    project: project as ProjectRecord,
    goals: goals as ProjectGoalRecord[],
    tasks: allTasks,
    statusCounts,
    taskTotalDurations,
  };
}

export async function generateMetadata({ params }: ProjectDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const projectDetail = await getProjectDetail(slug);

  if (!projectDetail) {
    return {
      title: "Project Not Found | Tasks",
    };
  }

  return {
    title: `${projectDetail.project.name} | Projects | Tasks`,
    description:
      projectDetail.project.description?.trim() ||
      `Task workspace for ${projectDetail.project.name}.`,
  };
}

export default async function ProjectDetailPage({
  params,
  searchParams,
}: ProjectDetailPageProps) {
  const [{ slug }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const [projectDetail, calendarSettingsResult] = await Promise.all([
    getProjectDetail(slug),
    getCalendarIntegrationSettings(),
  ]);

  if (!projectDetail) {
    notFound();
  }

  const activeView = normalizeProjectViewFilter(resolvedSearchParams.view);
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

  const { project, goals, tasks, statusCounts, taskTotalDurations } = projectDetail;
  const calendarFormDefaults = getCalendarTaskFormDefaults(calendarSettingsResult.data);
  const projectIsArchived = isProjectArchivedStatus(project.status);
  const baseProjectsHref =
    activeView === "active" ? "/tasks/projects" : `/tasks/projects?view=${activeView}`;
  const taskFilterBasePath =
    activeView === "active"
      ? `/tasks/projects/${project.slug}`
      : `/tasks/projects/${project.slug}?view=${activeView}`;
  const deleteHref =
    activeView === "active"
      ? `/tasks/projects/${project.slug}/delete`
      : `/tasks/projects/${project.slug}/delete?view=${activeView}`;
  let returnTo = buildTaskFilterReturnPath(`/tasks/projects/${project.slug}`, {
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
  const filteredTasks = applyTaskListQuery(
    tasks.filter((task) => {
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
    },
  );

  const focusedTask = filteredTasks[0] ?? null;
  const focusQueue = sortFocusQueueTasks(filteredTasks);
  const focusedDurationSeconds = focusedTask ? taskTotalDurations[focusedTask.id] ?? 0 : 0;
  const completedRelatedTasks = filteredTasks.filter((task) => task.status === "done").length;
  const completedProjectTasks = tasks.filter((task) => task.status === "done").length;
  const openProjectTasks = tasks.length - completedProjectTasks;
  const projectStatusChips = statusCounts.map((entry) => (
    <Badge key={entry.status} tone={getTaskStatusTone(entry.status)}>
      {entry.count} {formatTaskToken(entry.status)}
    </Badge>
  ));
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
        <Link
          href={baseProjectsHref}
          className="btn-instrument btn-instrument-muted flex h-8 items-center px-4"
        >
          Back to Projects
        </Link>
      }
    >
      <div className="flex flex-col gap-6">
        <Card
          label="Overview"
          title={project.name}
          action={
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={getTaskStatusTone(project.status)}>
                {formatTaskToken(project.status)}
              </Badge>
              {projectIsArchived ? <Badge tone="warn">Archived</Badge> : null}
              <Badge tone="muted">{goals.length} goals</Badge>
            </div>
          }
        >
          <CardContent className="flex flex-col gap-4">
            <p className="max-w-[80ch] text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-ega-text-secondary">
              {project.description?.trim() ||
                "No description has been added for this project yet."}
            </p>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Tasks" value={tasks.length} caption="in this project" />
              <Metric label="Completed" value={completedProjectTasks} caption="tasks marked done" />
              <Metric label="Open" value={openProjectTasks} caption="tasks not done" />
              <Metric label="Goals" value={goals.length} caption="linked to this project" />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {statusCounts.length ? (
                projectStatusChips
              ) : (
                <span className="text-[length:var(--text-meta-lg)] text-ega-text-tertiary">
                  No task activity yet
                </span>
              )}
            </div>

            {focusedTask ? (
              <div className="rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[color:var(--ega-surface-subtle)] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="glass-label">Current focus</p>
                    <p className="mt-1 truncate text-[length:var(--text-body)] font-medium text-ega-text">
                      {focusedTask.title}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={getTaskStatusTone(focusedTask.status)}>
                      {formatTaskToken(focusedTask.status)}
                    </Badge>
                    <Badge tone="muted">{formatTaskToken(focusedTask.priority)}</Badge>
                    {focusedTask.focus_rank ? (
                      <Badge tone="info">Pinned #{focusedTask.focus_rank}</Badge>
                    ) : null}
                    {focusedTask.task_recurrences[0] ? (
                      <Badge tone="info">
                        {formatTaskRecurrenceRule(focusedTask.task_recurrences[0].rule)}
                      </Badge>
                    ) : null}
                  </div>
                </div>

                {focusedTask.status === "blocked" && focusedTask.blocked_reason?.trim() ? (
                  <p className="feedback-block feedback-block-warn mt-3">
                    Blocked: {focusedTask.blocked_reason.trim()}
                  </p>
                ) : null}

                <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt className="glass-label">Goal</dt>
                    <dd className="mt-1 text-[length:var(--text-body)] text-ega-text">
                      {focusedTask.goals?.title ?? "No linked goal"}
                    </dd>
                  </div>
                  <div>
                    <dt className="glass-label">Due</dt>
                    <dd className="mt-1">
                      {focusedTask.due_date ? (
                        <TaskDueDateLabel
                          dueDate={focusedTask.due_date}
                          status={focusedTask.status}
                        />
                      ) : (
                        <span className="text-[length:var(--text-body)] text-ega-text">
                          No due date
                        </span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="glass-label">Estimate</dt>
                    <dd className="mt-1 text-[length:var(--text-body)] text-ega-text">
                      {focusedTask.estimate_minutes
                        ? formatTaskEstimate(focusedTask.estimate_minutes)
                        : "No estimate"}
                    </dd>
                  </div>
                  <div>
                    <dt className="glass-label">Updated</dt>
                    <dd className="mt-1 text-[length:var(--text-body)] text-ega-text">
                      {formatTimerDateTime(focusedTask.updated_at)}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : (
              <p className="surface-empty px-4 py-4 text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-ega-text-secondary">
                No tasks match the current project filters.
              </p>
            )}
          </CardContent>

          <CardFooter className="flex-wrap justify-between gap-3">
            <div className="min-w-0">
              {projectIsArchived ? (
                <p className="max-w-[60ch] text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-ega-text-secondary">
                  Archived projects stay available for reference. Archiving does not automatically
                  archive linked goals or tasks.
                </p>
              ) : (
                <InlineProjectStatusForm
                  action={updateProjectStatusAction}
                  projectId={project.id}
                  returnTo={returnTo}
                  defaultStatus={project.status}
                  error={
                    projectUpdateProjectId === project.id && projectUpdateField === "status"
                      ? projectUpdateError
                      : null
                  }
                />
              )}
            </div>

            <div className="flex flex-col items-end gap-2">
              {archiveError ? (
                <p role="alert" className="feedback-block feedback-block-error">
                  {archiveError}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <form action={projectIsArchived ? unarchiveProjectAction : archiveProjectAction}>
                  <input type="hidden" name="projectId" value={project.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <Button
                    type="submit"
                    variant={projectIsArchived ? "secondary" : "danger"}
                    size="sm"
                  >
                    {projectIsArchived ? "Unarchive project" : "Archive project"}
                  </Button>
                </form>
                {projectIsArchived ? (
                  <Link
                    href={deleteHref}
                    className={cn(buttonVariants({ variant: "danger", size: "sm" }))}
                  >
                    Delete permanently
                  </Link>
                ) : null}
              </div>
            </div>
          </CardFooter>
        </Card>

        <div className="workspace-split-grid">
          <Card
            label="Execution"
            title="Project tasks"
            action={
              <Badge tone="muted">
                {completedRelatedTasks}/{filteredTasks.length} done
              </Badge>
            }
          >
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-1.5">
                {statusCounts.length ? (
                  projectStatusChips
                ) : (
                  <span className="text-[length:var(--text-meta-lg)] text-ega-text-tertiary">
                    No task activity yet
                  </span>
                )}
              </div>

              <div className="rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[color:var(--ega-surface-subtle)] px-3 py-2">
                <TaskFilterControls
                  basePath={taskFilterBasePath}
                  activeStatus={activeStatus}
                  activePriority={activePriority}
                  activeDueFilter={activeDueFilter}
                  activeSort={activeSort}
                  includePriority
                />
              </div>

              {taskUpdateSuccess ? (
                <p role="status" className="feedback-block">
                  {taskUpdateSuccess}
                </p>
              ) : null}

              {filteredTasks.length ? (
                <ul className="rows">
                  {filteredTasks.map((task, index) => {
                    const inlineError = taskUpdateTaskId === task.id ? taskUpdateError : null;

                    return (
                      <li
                        key={task.id}
                        id={`task-${task.id}`}
                        className="scroll-mt-24 border-b border-[var(--ega-divider)] last:border-b-0"
                      >
                        <details className="group" open={Boolean(inlineError)}>
                          <summary className="row cursor-pointer list-none">
                            <span className="row-main">
                              <span className="row-title">
                                {task.title}
                                {index === 0 ? <span className="sr-only"> (current focus)</span> : null}
                              </span>
                              <span className="row-meta">
                                {task.goals?.title ?? "No linked goal"}
                                {" · Updated "}
                                {formatTimerDateTime(task.updated_at)}
                              </span>
                            </span>
                            <span className="row-actions">
                              {task.status === "blocked" && task.blocked_reason?.trim() ? (
                                <span className="hidden sm:inline-flex">
                                  <Badge tone="error">Blocked</Badge>
                                </span>
                              ) : null}
                              <Badge tone={getTaskStatusTone(task.status)}>
                                {formatTaskToken(task.status)}
                              </Badge>
                              <span className="hidden sm:inline-flex">
                                <Badge tone="muted">{formatTaskToken(task.priority)}</Badge>
                              </span>
                              {task.focus_rank ? (
                                <span className="hidden sm:inline-flex">
                                  <Badge tone="info">#{task.focus_rank}</Badge>
                                </span>
                              ) : null}
                              <ChevronRight
                                className="h-4 w-4 shrink-0 text-[color:var(--ega-text-tertiary)] transition-transform group-open:rotate-90"
                                aria-hidden="true"
                              />
                            </span>
                          </summary>

                          <div className="flex flex-col gap-3 border-t border-[var(--ega-divider)] bg-[color:var(--ega-surface-subtle)] px-4 py-3">
                            {task.due_date || task.estimate_minutes || task.task_recurrences[0] ? (
                              <div className="flex flex-wrap items-center gap-2">
                                {task.due_date ? (
                                  <TaskDueDateLabel dueDate={task.due_date} status={task.status} />
                                ) : null}
                                {task.estimate_minutes ? (
                                  <Badge tone="muted">
                                    Est. {formatTaskEstimate(task.estimate_minutes)}
                                  </Badge>
                                ) : null}
                                {task.task_recurrences[0] ? (
                                  <Badge tone="info">
                                    {formatTaskRecurrenceRule(task.task_recurrences[0].rule)}
                                  </Badge>
                                ) : null}
                              </div>
                            ) : null}

                            {task.status === "blocked" && task.blocked_reason?.trim() ? (
                              <p className="feedback-block feedback-block-warn">
                                Blocked: {task.blocked_reason.trim()}
                              </p>
                            ) : null}

                            <TaskReminderPanel
                              taskId={task.id}
                              reminders={task.task_reminders}
                              returnTo={returnTo}
                              createAction={createTaskReminderAction}
                              cancelAction={cancelTaskReminderAction}
                            />

                            <InlineTaskUpdateForm
                              action={updateTaskInlineAction}
                              deleteAction={deleteTaskAction}
                              taskId={task.id}
                              taskTitle={task.title}
                              returnTo={returnTo}
                              defaultStatus={task.status}
                              defaultPriority={task.priority}
                              defaultDueDate={task.due_date}
                              defaultEstimateMinutes={task.estimate_minutes}
                              defaultScheduledStartAt={task.scheduled_start_at}
                              defaultScheduledEndAt={task.scheduled_end_at}
                              defaultCalendarSyncEnabled={task.calendar_sync_enabled}
                              defaultCalendarReminderMinutes={task.calendar_reminder_minutes}
                              defaultBlockedReason={task.blocked_reason}
                              defaultRecurrenceRule={task.task_recurrences[0]?.rule ?? null}
                              error={inlineError}
                            />

                            <FocusPinToggleForm
                              action={task.focus_rank ? unpinTaskAction : pinTaskAction}
                              taskId={task.id}
                              returnTo={returnTo}
                              isPinned={task.focus_rank !== null}
                              compact
                            />
                          </div>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="surface-empty px-4 py-5 text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-ega-text-secondary">
                  No tasks match the current project filters.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="workspace-secondary-rail">
            <Card
              label="Strategy"
              title="Project goals"
              action={<Badge tone="muted">{goals.length}</Badge>}
            >
              {goals.length ? (
                <ul className="rows">
                  {goals.map((goal) => (
                    <li key={goal.id} className="row">
                      <Link
                        href={`/goals?view=all&goal=${goal.id}#goal-${goal.id}`}
                        className="row-main"
                      >
                        <span className="row-title">{goal.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <CardContent>
                  <p className="text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-ega-text-secondary">
                    No goals are linked to this project yet.
                  </p>
                </CardContent>
              )}
            </Card>

            <Card
              label="Focus"
              title="Focus queue"
              action={<Badge tone="muted">{focusQueue.length}</Badge>}
            >
              {focusQueue.length > 0 ? (
                <ul className="rows">
                  {focusQueue.slice(0, 4).map((task) => (
                    <li key={task.id} className="row">
                      <span className="row-main">
                        <span className="row-title">{task.title}</span>
                        <span className="row-meta">#{task.focus_rank}</span>
                      </span>
                      <div className="row-actions">
                        <FocusPinToggleForm
                          action={unpinTaskAction}
                          taskId={task.id}
                          returnTo={returnTo}
                          isPinned
                          compact
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <CardContent>
                  <p className="text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-ega-text-secondary">
                    Pin tasks in this project to build a focused execution order.
                  </p>
                </CardContent>
              )}
            </Card>

            <Card label="Time" title="Time tracking">
              <CardContent className="flex flex-col gap-3">
                <Metric
                  label="Focused task duration"
                  value={formatDurationLabel(focusedDurationSeconds)}
                  caption="Logged against the currently focused task in this project slice."
                />
                <p className="text-[length:var(--text-meta)] text-ega-text-tertiary">
                  Session totals come from tracked timer history for this task.
                </p>
              </CardContent>
            </Card>

            <Card label="Activity" title="Recent activity">
              {tasks.length ? (
                <ul className="rows">
                  {tasks.slice(0, 3).map((task) => (
                    <li key={task.id} className="row">
                      <span className="row-main">
                        <span className="row-title">{task.title}</span>
                        <span className="row-meta">
                          Updated {formatTimerDateTime(task.updated_at)}
                        </span>
                      </span>
                      <span className="row-actions">
                        <Badge tone={getTaskStatusTone(task.status)}>
                          {formatTaskToken(task.status)}
                        </Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <CardContent>
                  <p className="text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-ega-text-secondary">
                    No task activity has been recorded for this project yet.
                  </p>
                </CardContent>
              )}
            </Card>

            <Card label="Create" title="New project task">
              <CardContent className="flex flex-col gap-3">
                <p className="text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-ega-text-secondary">
                  {projectIsArchived
                    ? `Restore ${project.name} before adding new execution work.`
                    : `New tasks created here stay attached to ${project.name}.`}
                </p>
                {projectIsArchived ? (
                  <p className="surface-empty px-4 py-4 text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-ega-text-secondary">
                    This archived project remains visible for review, but new tasks should wait
                    until the project is active again.
                  </p>
                ) : (
                  <CreateTaskForm
                    projects={[{ id: project.id, name: project.name }]}
                    goals={goals.map((goal) => ({
                      id: goal.id,
                      title: goal.title,
                      project_id: goal.projectId,
                    }))}
                    projectId={project.id}
                    returnTo={returnTo}
                    calendarDefaults={calendarFormDefaults}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </TasksWorkspaceShell>
  );
}
