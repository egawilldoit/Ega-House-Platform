import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CreateTaskForm } from "@/app/tasks/create-task-form";
import { updateTaskInlineAction } from "@/app/tasks/actions";
import { updateProjectStatusAction } from "@/app/tasks/projects/actions";
import { InlineProjectStatusForm } from "@/components/projects/inline-project-status-form";
import { TaskDueDateLabel } from "@/components/tasks/task-due-date-label";
import { InlineTaskUpdateForm } from "@/components/tasks/inline-task-update-form";
import {
  TaskFilterControls,
  buildTaskFilterReturnPath,
} from "@/components/tasks/task-filter-controls";
import { TasksWorkspaceShell } from "@/components/tasks/tasks-workspace-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
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
import { formatTimerDateTime } from "@/lib/timer-domain";
import {
  TASK_STATUS_VALUES,
  formatTaskToken,
  getTaskStatusTone,
  isTaskPriority,
  isTaskStatus,
} from "@/lib/task-domain";
import type { Tables } from "@/lib/supabase/database.types";

type ProjectRow = Pick<Tables<"projects">, "id" | "name" | "slug" | "description" | "status">;
type GoalRow = Pick<Tables<"goals">, "id" | "title" | "project_id">;
type TaskRow = Pick<
  Tables<"tasks">,
  "id" | "title" | "description" | "status" | "priority" | "due_date" | "updated_at" | "goal_id"
> & {
  goals: Pick<Tables<"goals">, "title"> | null;
};

type ProjectDetailPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    status?: string;
    priority?: string;
    due?: string;
    sort?: string;
    taskUpdateError?: string;
    taskUpdateTaskId?: string;
    projectUpdateError?: string;
    projectUpdateProjectId?: string;
  }>;
};

async function getProjectDetail(slug: string) {
  const supabase = await createClient();

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, name, slug, description, status")
    .eq("slug", slug)
    .maybeSingle();

  if (projectError) {
    throw new Error(`Failed to load project: ${projectError.message}`);
  }

  if (!project) {
    return null;
  }

  const [goalsResult, tasksResult] = await Promise.all([
    supabase
      .from("goals")
      .select("id, title, project_id")
      .eq("project_id", project.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("tasks")
      .select("id, title, description, status, priority, due_date, updated_at, goal_id, goals(title)")
      .eq("project_id", project.id)
      .order("updated_at", { ascending: false }),
  ]);

  if (goalsResult.error) {
    throw new Error(`Failed to load project goals: ${goalsResult.error.message}`);
  }

  if (tasksResult.error) {
    throw new Error(`Failed to load project tasks: ${tasksResult.error.message}`);
  }

  const allTasks = (tasksResult.data ?? []) as TaskRow[];
  const statusCounts = TASK_STATUS_VALUES.map((status) => ({
    status,
    count: allTasks.filter((task) => task.status === status).length,
  })).filter((entry) => entry.count > 0);

  const taskTotalDurations = await getTaskTotalDurationMap(
    supabase,
    allTasks.map((task) => task.id),
  );

  return {
    project: project as ProjectRow,
    goals: goalsResult.data as GoalRow[],
    tasks: allTasks,
    statusCounts,
    taskTotalDurations,
  };
}

function getTimeProgressPercent(seconds: number) {
  const targetSeconds = 8 * 60 * 60;
  return Math.max(0, Math.min(100, Math.round((seconds / targetSeconds) * 100)));
}

function ProgressRing({ percent, label }: { percent: number; label: string }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - percent / 100);

  return (
    <div className="relative flex h-32 w-32 items-center justify-center">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
        <circle
          className="stroke-[color:var(--border)]"
          cx="50"
          cy="50"
          fill="none"
          r={radius}
          strokeWidth="6"
        />
        <circle
          className="stroke-[var(--signal-live)]"
          cx="50"
          cy="50"
          fill="none"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          strokeWidth="6"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
          {label}
        </span>
        <span className="glass-label text-etch">Logged</span>
      </div>
    </div>
  );
}

export async function generateMetadata({ params }: ProjectDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const projectDetail = await getProjectDetail(slug);

  if (!projectDetail) {
    return {
      title: "Project Not Found | Tasks | EGA House",
    };
  }

  return {
    title: `${projectDetail.project.name} | Projects | Tasks | EGA House`,
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
  const projectDetail = await getProjectDetail(slug);

  if (!projectDetail) {
    notFound();
  }

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
  const taskUpdateTaskId = resolvedSearchParams.taskUpdateTaskId ?? null;
  const projectUpdateError = resolvedSearchParams.projectUpdateError?.slice(0, 180) ?? null;
  const projectUpdateProjectId = resolvedSearchParams.projectUpdateProjectId ?? null;

  const { project, goals, tasks, statusCounts, taskTotalDurations } = projectDetail;
  const returnTo = buildTaskFilterReturnPath(`/tasks/projects/${project.slug}`, {
    status: activeStatus,
    priority: activePriority,
    due: activeDueFilter,
    sort: activeSort,
  });
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
  const siblingTasks = filteredTasks.slice(1);
  const focusedDurationSeconds = focusedTask ? taskTotalDurations[focusedTask.id] ?? 0 : 0;
  const completedRelatedTasks = filteredTasks.filter((task) => task.status === "done").length;

  return (
    <TasksWorkspaceShell
      eyebrow={project.slug}
      title={focusedTask?.title ?? project.name}
      description={
        focusedTask?.description?.trim() ||
        project.description?.trim() ||
        "Project-scoped task detail view for the active execution slice."
      }
      actions={
        <Link
          href="/tasks/projects"
          className="btn-instrument btn-instrument-muted flex h-8 items-center px-4"
        >
          Back to Projects
        </Link>
      }
    >
      <div className="mb-8 flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-5">
        <Link href="/tasks/projects" className="glass-label text-etch transition hover:text-signal-live">
          Projects
        </Link>
        <span className="glass-label text-etch">/</span>
        <span className="glass-label text-etch">{project.name}</span>
        {focusedTask ? (
          <>
            <span className="glass-label text-etch">/</span>
            <span className="glass-label text-[color:var(--foreground)]">
              {focusedTask.id.slice(0, 8).toUpperCase()}
            </span>
          </>
        ) : null}
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(20rem,0.92fr)]">
        <div className="space-y-6">
          <Card className="border-[var(--border)] bg-[color:var(--instrument)]">
            <CardContent className="p-8">
              <div className="mb-6 flex flex-wrap items-center gap-2">
                <Badge tone={getTaskStatusTone(focusedTask?.status ?? project.status)}>
                  {formatTaskToken(focusedTask?.status ?? project.status)}
                </Badge>
                {focusedTask ? <Badge>{formatTaskToken(focusedTask.priority)}</Badge> : null}
              </div>

              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.55fr)]">
                <div>
                  <h2 className="text-4xl font-semibold tracking-tight text-[color:var(--foreground)]">
                    {focusedTask?.title ?? project.name}
                  </h2>
                  <div className="mt-4 space-y-4 text-sm leading-7 text-[color:var(--muted-foreground)]">
                    <p>
                      {focusedTask?.description?.trim() ||
                        project.description?.trim() ||
                        "No description has been added for this task yet."}
                    </p>
                    {focusedTask ? (
                      <TaskDueDateLabel dueDate={focusedTask.due_date} status={focusedTask.status} />
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-3 rounded-[1.1rem] border border-[var(--border)] bg-white/70 p-4 sm:grid-cols-3 lg:grid-cols-1">
                  <div>
                    <p className="glass-label text-etch">Project</p>
                    <p className="mt-2 text-sm font-medium text-[color:var(--foreground)]">
                      {project.name}
                    </p>
                  </div>
                  <div>
                    <p className="glass-label text-etch">Goal</p>
                    <p className="mt-2 text-sm font-medium text-[color:var(--foreground)]">
                      {focusedTask?.goals?.title ?? "No linked goal"}
                    </p>
                  </div>
                  <div>
                    <p className="glass-label text-etch">Due</p>
                    <div className="mt-2">
                      {focusedTask?.due_date ? (
                        <TaskDueDateLabel
                          dueDate={focusedTask.due_date}
                          status={focusedTask.status}
                          textClassName="text-sm font-medium text-[color:var(--foreground)]"
                        />
                      ) : (
                        <p className="text-sm font-medium text-[color:var(--foreground)]">
                          No due date
                        </p>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="glass-label text-etch">Updated</p>
                    <p className="mt-2 text-sm font-medium text-[color:var(--foreground)]">
                      {focusedTask ? formatTimerDateTime(focusedTask.updated_at) : "No updates"}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-[var(--border)] bg-[color:var(--instrument)]">
            <CardContent className="p-8">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold tracking-tight text-[color:var(--foreground)]">
                    Related Tasks
                  </h3>
                  <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
                    {completedRelatedTasks}/{filteredTasks.length} completed in the current slice.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {statusCounts.length ? (
                    statusCounts.map((entry) => (
                      <Badge key={entry.status} tone={getTaskStatusTone(entry.status)}>
                        {entry.count} {formatTaskToken(entry.status)}
                      </Badge>
                    ))
                  ) : (
                    <Badge>No task activity yet</Badge>
                  )}
                </div>
              </div>

              <div className="mb-6">
                <TaskFilterControls
                  basePath={`/tasks/projects/${project.slug}`}
                  activeStatus={activeStatus}
                  activePriority={activePriority}
                  activeDueFilter={activeDueFilter}
                  activeSort={activeSort}
                  includePriority
                />
              </div>

              <div className="mb-6 border-t border-[var(--border)] pt-4">
                <InlineProjectStatusForm
                  action={updateProjectStatusAction}
                  projectId={project.id}
                  returnTo={returnTo}
                  defaultStatus={project.status}
                  error={projectUpdateProjectId === project.id ? projectUpdateError : null}
                />
              </div>

              {focusedTask ? (
                <div className="space-y-3">
                  <article className="rounded-[1rem] border border-[var(--border)] bg-[color:var(--instrument-raised)] px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-[color:var(--foreground)]">
                          {focusedTask.title}
                        </p>
                        <p className="mt-1 text-[0.625rem] uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                          Focused task
                        </p>
                        <TaskDueDateLabel
                          dueDate={focusedTask.due_date}
                          status={focusedTask.status}
                          className="mt-2"
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge tone={getTaskStatusTone(focusedTask.status)}>
                          {formatTaskToken(focusedTask.status)}
                        </Badge>
                        <Badge>{formatTaskToken(focusedTask.priority)}</Badge>
                      </div>
                    </div>
                    <div className="mt-4 border-t border-[var(--border)] pt-4">
                      <InlineTaskUpdateForm
                        action={updateTaskInlineAction}
                        taskId={focusedTask.id}
                        returnTo={returnTo}
                        defaultStatus={focusedTask.status}
                        defaultPriority={focusedTask.priority}
                        defaultDueDate={focusedTask.due_date}
                        error={taskUpdateTaskId === focusedTask.id ? taskUpdateError : null}
                      />
                    </div>
                  </article>

                  {siblingTasks.map((task) => {
                    const inlineError = taskUpdateTaskId === task.id ? taskUpdateError : null;

                    return (
                      <article
                        key={task.id}
                        id={`task-${task.id}`}
                        className="rounded-[1rem] border border-[var(--border)] bg-[color:var(--instrument-raised)] px-4 py-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-[color:var(--foreground)]">
                              {task.title}
                            </p>
                            <p className="mt-1 text-[0.625rem] uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                              {task.goals?.title ?? "No linked goal"}
                            </p>
                            <TaskDueDateLabel
                              dueDate={task.due_date}
                              status={task.status}
                              className="mt-2"
                            />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Badge tone={getTaskStatusTone(task.status)}>
                              {formatTaskToken(task.status)}
                            </Badge>
                            <Badge>{formatTaskToken(task.priority)}</Badge>
                          </div>
                        </div>
                        <div className="mt-4 border-t border-[var(--border)] pt-4">
                          <InlineTaskUpdateForm
                            action={updateTaskInlineAction}
                            taskId={task.id}
                            returnTo={returnTo}
                            defaultStatus={task.status}
                            defaultPriority={task.priority}
                            defaultDueDate={task.due_date}
                            error={inlineError}
                          />
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="surface-empty px-4 py-5 text-sm leading-7 text-[color:var(--muted-foreground)]">
                  No tasks match the current project filters.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-[var(--border)] bg-[color:var(--instrument)]">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold tracking-tight text-[color:var(--foreground)]">
                Time Tracking
              </h3>
              <div className="flex flex-col items-center py-4">
                <ProgressRing
                  percent={getTimeProgressPercent(focusedDurationSeconds)}
                  label={formatDurationLabel(focusedDurationSeconds)}
                />
                <p className="mt-4 text-xs uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                  Focused task duration
                </p>
              </div>
              <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">
                Logged against the currently focused task in this project slice.
              </p>
            </CardContent>
          </Card>

          <Card className="border-[var(--border)] bg-[color:var(--instrument)]">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold tracking-tight text-[color:var(--foreground)]">
                Recent Activity
              </h3>
              <div className="mt-5 space-y-3">
                {tasks.slice(0, 3).map((task) => (
                  <div
                    key={task.id}
                    className="rounded-[1rem] border border-[var(--border)] bg-[color:var(--instrument-raised)] px-4 py-4"
                  >
                    <p className="text-sm font-medium text-[color:var(--foreground)]">
                      {task.title}
                    </p>
                    <div className="mt-1 space-y-1">
                      <p className="text-xs text-[color:var(--muted-foreground)]">
                        Updated {formatTimerDateTime(task.updated_at)}
                      </p>
                      <TaskDueDateLabel dueDate={task.due_date} status={task.status} />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-[var(--border)] bg-[color:var(--instrument)]">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold tracking-tight text-[color:var(--foreground)]">
                Create Related Task
              </h3>
              <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                New tasks created here stay attached to {project.name}.
              </p>
              <div className="mt-4">
                <CreateTaskForm
                  projects={[{ id: project.id, name: project.name }]}
                  goals={goals}
                  projectId={project.id}
                  returnTo={returnTo}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </TasksWorkspaceShell>
  );
}
