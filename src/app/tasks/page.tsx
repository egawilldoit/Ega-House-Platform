import type { Metadata } from "next";
import Link from "next/link";

import {
  pinTaskAction,
  unpinTaskAction,
  updateTaskInlineAction,
} from "@/app/tasks/actions";
import { CreateTaskForm } from "@/app/tasks/create-task-form";
import { FocusPinToggleForm } from "@/components/tasks/focus-pin-toggle-form";
import { TaskDueDateLabel } from "@/components/tasks/task-due-date-label";
import { TaskSavedViewsPanel } from "@/components/tasks/task-saved-views-panel";
import { InlineTaskUpdateForm } from "@/components/tasks/inline-task-update-form";
import {
  TaskFilterControls,
  buildTaskFilterReturnPath,
} from "@/components/tasks/task-filter-controls";
import { TasksWorkspaceShell } from "@/components/tasks/tasks-workspace-shell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { sortFocusQueueTasks } from "@/lib/focus-queue";
import {
  DEFAULT_TASK_DUE_FILTER,
  DEFAULT_TASK_SORT,
  isTaskDueFilter,
  isTaskSortValue,
  type TaskDueFilter,
  type TaskSortValue,
} from "@/lib/task-list";
import { formatDurationLabel } from "@/lib/task-session";
import {
  formatTaskToken,
  getTaskStatusTone,
  isTaskStatus,
  type TaskStatus,
} from "@/lib/task-domain";
import { isTaskDueSoon, isTaskOverdue } from "@/lib/task-due-date";
import { formatTaskEstimate } from "@/lib/task-estimate";
import { getTasksWorkspaceData } from "@/lib/services/task-service";

export const metadata: Metadata = {
  title: "Tasks | EGA House",
  description: "Task list with status and goal filters plus creation flow.",
};

type TasksPageProps = {
  searchParams: Promise<{
    status?: string;
    project?: string;
    goal?: string;
    due?: string;
    sort?: string;
    taskUpdateError?: string;
    taskUpdateTaskId?: string;
    statusUpdateError?: string;
    viewError?: string;
    viewSuccess?: string;
  }>;
};

function getTaskSignalTone(status: string, priority: string) {
  if (status === "blocked" || priority === "urgent") {
    return "bg-[var(--signal-error)]";
  }
  if (priority === "high") {
    return "bg-[var(--signal-warn)]";
  }
  if (status === "in_progress") {
    return "bg-[var(--signal-live)]";
  }
  return "bg-[var(--signal-info)]";
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const resolvedSearchParams = await searchParams;
  const statusParam = resolvedSearchParams.status;
  const projectParam = resolvedSearchParams.project?.trim() || null;
  const goalParam = resolvedSearchParams.goal?.trim() || null;
  const dueParam = resolvedSearchParams.due?.trim() || DEFAULT_TASK_DUE_FILTER;
  const sortParam = resolvedSearchParams.sort?.trim() || DEFAULT_TASK_SORT;
  const activeStatus: TaskStatus | null =
    statusParam && isTaskStatus(statusParam) ? statusParam : null;
  const activeDueFilter: TaskDueFilter = isTaskDueFilter(dueParam)
    ? dueParam
    : DEFAULT_TASK_DUE_FILTER;
  const activeSort: TaskSortValue = isTaskSortValue(sortParam)
    ? sortParam
    : DEFAULT_TASK_SORT;
  const taskUpdateError =
    resolvedSearchParams.taskUpdateError?.slice(0, 180) ??
    resolvedSearchParams.statusUpdateError?.slice(0, 180) ??
    null;
  const taskUpdateTaskId = resolvedSearchParams.taskUpdateTaskId ?? null;
  const savedViewFeedback = {
    error: resolvedSearchParams.viewError?.slice(0, 180) ?? null,
    success: resolvedSearchParams.viewSuccess?.slice(0, 180) ?? null,
  };
  const {
    projects,
    goals,
    tasks,
    taskTotalDurations,
    savedViews,
    savedViewsUnavailable,
    activeProjectId,
    activeGoalId,
  } = await getTasksWorkspaceData({
    activeStatus,
    requestedProjectId: projectParam,
    requestedGoalId: goalParam,
    activeDueFilter,
    activeSort,
  });
  const resolvedSavedViewFeedback = {
    error:
      savedViewFeedback.error ??
      (savedViewsUnavailable
        ? "Saved views are temporarily unavailable while database schema updates propagate."
        : null),
    success: savedViewFeedback.success,
  };
  const returnPath = buildTaskFilterReturnPath("/tasks", {
    status: activeStatus,
    project: activeProjectId,
    goal: activeGoalId,
    due: activeDueFilter,
    sort: activeSort,
  });
  const inProgressCount = tasks.filter((task) => task.status === "in_progress").length;
  const blockedCount = tasks.filter((task) => task.status === "blocked").length;
  const overdueCount = tasks.filter((task) => isTaskOverdue(task.due_date, task.status)).length;
  const dueSoonCount = tasks.filter((task) => isTaskDueSoon(task.due_date, task.status)).length;
  const focusQueue = sortFocusQueueTasks(tasks);

  return (
    <TasksWorkspaceShell
      eyebrow="Execution Workspace"
      title="Tasks"
      description="Active execution queue with inline state control and task initialization."
      actions={
        <Link
          href="/tasks/projects"
          className="btn-instrument btn-instrument-muted glass-label flex h-8 items-center gap-2 px-4"
        >
          Projects
        </Link>
      }
    >
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.32fr)_minmax(22rem,0.78fr)]">
        <Card className="self-start border-[var(--border)] bg-white">
          <CardHeader className="gap-4 border-b border-[var(--border)] pb-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="glass-label text-etch">Active Execution Queue</p>
                <CardTitle className="mt-2">Operational task slice</CardTitle>
                <CardDescription>
                  {tasks.length} item{tasks.length !== 1 ? "s" : ""} in the current queue with
                  inline state control.
                </CardDescription>
              </div>
              <CardAction className="flex-wrap">
                <Badge tone="muted">{tasks.length} visible</Badge>
                <Badge tone={blockedCount > 0 ? "warn" : "muted"}>
                  {blockedCount} blocked
                </Badge>
                <Badge tone={inProgressCount > 0 ? "info" : "muted"}>
                  {inProgressCount} in progress
                </Badge>
                <Badge tone={overdueCount > 0 ? "error" : "muted"}>
                  {overdueCount} overdue
                </Badge>
                <Badge tone={dueSoonCount > 0 ? "warn" : "muted"}>
                  {dueSoonCount} due soon
                </Badge>
              </CardAction>
            </div>

            <div className="rounded-[1.1rem] border border-[var(--border)] bg-[color:var(--instrument)] p-4">
              <TaskFilterControls
                basePath="/tasks"
                activeStatus={activeStatus}
                activeProjectId={activeProjectId}
                activeGoalId={activeGoalId}
                activeDueFilter={activeDueFilter}
                activeSort={activeSort}
                projectOptions={projects}
                goalOptions={goals.map((goal) => ({ id: goal.id, title: goal.title }))}
              />
            </div>
          </CardHeader>

          <CardContent className="space-y-3 pt-5">
            {tasks.length === 0 ? (
              <div className="surface-empty px-5 py-5 text-center">
                <p className="glass-label text-etch">No tasks match current filters</p>
                <p className="mt-2 text-sm leading-6 text-[color:var(--muted-foreground)]">
                  Reset one or more filters to bring the execution queue back into view.
                </p>
              </div>
            ) : (
              tasks.map((task) => {
                const inlineError = taskUpdateTaskId === task.id ? taskUpdateError : null;

                return (
                  <article
                    key={task.id}
                    id={`task-${task.id}`}
                    className="scroll-mt-24 rounded-[1.05rem] border border-[var(--border)] bg-[color:var(--instrument-raised)] px-4 py-4"
                  >
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
                      <div className="min-w-0">
                        <div className="flex items-start gap-3">
                          <span
                            className={`mt-2 h-2 w-2 shrink-0 rounded-full ${getTaskSignalTone(
                              task.status,
                              task.priority,
                            )}`}
                          />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h2 className="truncate text-base font-medium text-[color:var(--foreground)]">
                                  {task.title}
                                </h2>
                                <p className="mt-1 text-[0.625rem] uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                                  {task.projects?.name ?? "No project"}
                                  {task.goals?.title ? ` · ${task.goals.title}` : ""}
                                </p>
                              </div>

                              <div className="flex flex-wrap gap-2 xl:hidden">
                                <Badge tone={getTaskStatusTone(task.status)}>
                                  {formatTaskToken(task.status)}
                                </Badge>
                                <Badge tone="muted">{formatTaskToken(task.priority)}</Badge>
                                {task.focus_rank ? <Badge tone="info">Pinned #{task.focus_rank}</Badge> : null}
                              </div>
                            </div>

                            {task.description ? (
                              <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:var(--muted-foreground)]">
                                {task.description}
                              </p>
                            ) : null}

                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <TaskDueDateLabel dueDate={task.due_date} status={task.status} />
                              {task.estimate_minutes ? (
                                <Badge tone="muted">Est. {formatTaskEstimate(task.estimate_minutes)}</Badge>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="hidden flex-wrap gap-2 xl:flex">
                        <Badge tone={getTaskStatusTone(task.status)}>
                          {formatTaskToken(task.status)}
                        </Badge>
                        <Badge tone="muted">{formatTaskToken(task.priority)}</Badge>
                                {task.focus_rank ? <Badge tone="info">Pinned #{task.focus_rank}</Badge> : null}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 border-t border-[var(--border)] pt-4 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start">
                      <div className="flex flex-wrap gap-3">
                        <div className="grid min-w-32 gap-1 rounded-[0.9rem] border border-[var(--border)] bg-white/70 px-3 py-3">
                          <p className="glass-label text-etch">Tracked</p>
                          <p className="text-sm font-medium text-[color:var(--foreground)]">
                            {formatDurationLabel(taskTotalDurations[task.id] ?? 0)}
                          </p>
                        </div>
                        {task.estimate_minutes ? (
                          <div className="grid min-w-32 gap-1 rounded-[0.9rem] border border-[var(--border)] bg-white/70 px-3 py-3">
                            <p className="glass-label text-etch">Estimate</p>
                            <p className="text-sm font-medium text-[color:var(--foreground)]">
                              {formatTaskEstimate(task.estimate_minutes)}
                            </p>
                          </div>
                        ) : null}
                      </div>

                      <InlineTaskUpdateForm
                        action={updateTaskInlineAction}
                        taskId={task.id}
                        returnTo={returnPath}
                        defaultStatus={task.status}
                        defaultPriority={task.priority}
                        defaultDueDate={task.due_date}
                        defaultEstimateMinutes={task.estimate_minutes}
                        error={inlineError}
                      />
                      <div className="lg:justify-self-end">
                        <FocusPinToggleForm
                          action={task.focus_rank ? unpinTaskAction : pinTaskAction}
                          taskId={task.id}
                          returnTo={returnPath}
                          isPinned={task.focus_rank !== null}
                          compact
                        />
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </CardContent>

          <CardFooter className="justify-between">
            <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              Filters stay encoded in the URL for direct return to this queue slice.
            </p>
            <Link href="/tasks/projects" className="glass-label text-signal-live">
              Manage projects
            </Link>
          </CardFooter>
        </Card>

        <div className="space-y-6">
          <TaskSavedViewsPanel
            currentFilters={{
              status: activeStatus,
              projectId: activeProjectId,
              goalId: activeGoalId,
              dueFilter: activeDueFilter,
              sortValue: activeSort,
            }}
            savedViews={savedViews}
            projectOptions={projects}
            goalOptions={goals.map((goal) => ({ id: goal.id, title: goal.title }))}
              feedback={resolvedSavedViewFeedback}
            />

          <Card className="border-[var(--border)] bg-white">
            <CardHeader className="pb-4">
              <p className="glass-label text-signal-live">Focus Queue</p>
              <CardTitle className="text-xl">Pinned tasks</CardTitle>
              <CardDescription>
                A lightweight execution queue independent from priority.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {focusQueue.length > 0 ? (
                focusQueue.slice(0, 5).map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between gap-3 rounded-[0.9rem] border border-[var(--border)] bg-[color:var(--instrument)] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[color:var(--foreground)]">
                        {task.title}
                      </p>
                      <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
                        #{task.focus_rank} · {task.projects?.name ?? "No project"}
                      </p>
                    </div>
                    <FocusPinToggleForm
                      action={unpinTaskAction}
                      taskId={task.id}
                      returnTo={returnPath}
                      isPinned
                      compact
                    />
                  </div>
                ))
              ) : (
                <div className="surface-empty px-4 py-4 text-sm leading-6 text-[color:var(--muted-foreground)]">
                  Pin tasks from the queue to build a deliberate focus order.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-[var(--border)] bg-white">
            <CardHeader className="pb-4">
              <p className="glass-label text-signal-live">Queue Summary</p>
              <CardTitle className="text-xl">Workspace pressure</CardTitle>
              <CardDescription>
                Quick context for the current execution slice before you update or create work.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 pt-0 sm:grid-cols-3 xl:grid-cols-1">
              <div className="rounded-[1rem] border border-[var(--border)] bg-[color:var(--instrument)] px-4 py-3">
                <p className="glass-label text-etch">Projects</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
                  {projects.length}
                </p>
                <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                  selectable execution streams
                </p>
              </div>
              <div className="rounded-[1rem] border border-[var(--border)] bg-[color:var(--instrument)] px-4 py-3">
                <p className="glass-label text-etch">Goals</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
                  {goals.length}
                </p>
                <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                  available planning anchors
                </p>
              </div>
              <div className="rounded-[1rem] border border-[var(--border)] bg-[color:var(--instrument)] px-4 py-3">
                <p className="glass-label text-etch">Visible</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
                  {tasks.length}
                </p>
                <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                  task{tasks.length === 1 ? "" : "s"} in current slice
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="self-start border-[var(--border)] bg-white">
            <CardHeader>
              <p className="glass-label text-signal-live">Initialize Task</p>
              <CardTitle className="text-xl">Create directly into the queue</CardTitle>
              <CardDescription>
                Open a new task directly into the current execution surface.
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-0">
              {projects.length === 0 ? (
                <div className="space-y-3">
                  <div className="surface-empty px-4 py-4 text-center">
                    <p className="glass-label text-etch">No projects yet. Create one first.</p>
                  </div>
                  <Link
                    href="/tasks/projects/new"
                    className="btn-instrument flex h-9 items-center justify-center px-4"
                  >
                    Create project
                  </Link>
                </div>
              ) : (
                <CreateTaskForm
                  projects={projects}
                  goals={goals}
                  projectId={activeProjectId ?? undefined}
                  returnTo={returnPath}
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </TasksWorkspaceShell>
  );
}
