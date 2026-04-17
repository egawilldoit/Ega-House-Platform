import type { Metadata } from "next";
import Link from "next/link";

import { updateTaskInlineAction } from "@/app/tasks/actions";
import { CreateTaskForm } from "@/app/tasks/create-task-form";
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
import { createClient } from "@/lib/supabase/server";
import { formatDurationLabel, getTaskTotalDurationMap } from "@/lib/task-session";
import {
  formatTaskToken,
  getTaskStatusTone,
  isTaskStatus,
} from "@/lib/task-domain";

export const metadata: Metadata = {
  title: "Tasks | EGA House",
  description: "Task list with status and goal filters plus creation flow.",
};

type TasksPageProps = {
  searchParams: Promise<{
    status?: string;
    project?: string;
    goal?: string;
    taskUpdateError?: string;
    taskUpdateTaskId?: string;
    statusUpdateError?: string;
  }>;
};

async function getTasksData(
  activeStatus: string | null,
  requestedProjectId: string | null,
  requestedGoalId: string | null,
) {
  const supabase = await createClient();
  const [projectsResult, goalsResult] = await Promise.all([
    supabase.from("projects").select("id, name").order("name", { ascending: true }),
    supabase
      .from("goals")
      .select("id, title, project_id")
      .order("created_at", { ascending: false }),
  ]);
  if (projectsResult.error) {
    throw new Error(`Failed to load projects: ${projectsResult.error.message}`);
  }
  if (goalsResult.error) {
    throw new Error(`Failed to load goals: ${goalsResult.error.message}`);
  }
  const activeProjectId =
    requestedProjectId && projectsResult.data.some((project) => project.id === requestedProjectId)
      ? requestedProjectId
      : null;
  const visibleGoals = activeProjectId
    ? goalsResult.data.filter((goal) => goal.project_id === activeProjectId)
    : goalsResult.data;
  const activeGoalId =
    requestedGoalId && visibleGoals.some((goal) => goal.id === requestedGoalId)
      ? requestedGoalId
      : null;
  const tasksQuery = supabase
    .from("tasks")
    .select(
      "id, title, description, status, priority, updated_at, project_id, goal_id, projects(name), goals(title)",
    )
    .order("updated_at", { ascending: false });
  if (activeStatus) {
    tasksQuery.eq("status", activeStatus);
  }
  if (activeProjectId) {
    tasksQuery.eq("project_id", activeProjectId);
  }
  if (activeGoalId) {
    tasksQuery.eq("goal_id", activeGoalId);
  }
  const tasksResult = await tasksQuery;
  if (tasksResult.error) {
    throw new Error(`Failed to load tasks: ${tasksResult.error.message}`);
  }
  const tasks = tasksResult.data;
  const taskTotalDurations = await getTaskTotalDurationMap(
    supabase,
    tasks.map((task) => task.id),
  );
  return {
    projects: projectsResult.data,
    goals: visibleGoals,
    tasks,
    taskTotalDurations,
    activeProjectId,
    activeGoalId,
  };
}

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
  const activeStatus: string | null =
    statusParam && isTaskStatus(statusParam) ? statusParam : null;
  const taskUpdateError =
    resolvedSearchParams.taskUpdateError?.slice(0, 180) ??
    resolvedSearchParams.statusUpdateError?.slice(0, 180) ??
    null;
  const taskUpdateTaskId = resolvedSearchParams.taskUpdateTaskId ?? null;
  const { projects, goals, tasks, taskTotalDurations, activeProjectId, activeGoalId } =
    await getTasksData(activeStatus, projectParam, goalParam);
  const returnPath = buildTaskFilterReturnPath("/tasks", {
    status: activeStatus,
    project: activeProjectId,
    goal: activeGoalId,
  });
  const inProgressCount = tasks.filter((task) => task.status === "in_progress").length;
  const blockedCount = tasks.filter((task) => task.status === "blocked").length;

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
              </CardAction>
            </div>

            <div className="rounded-[1.1rem] border border-[var(--border)] bg-[color:var(--instrument)] p-4">
              <TaskFilterControls
                basePath="/tasks"
                activeStatus={activeStatus}
                activeProjectId={activeProjectId}
                activeGoalId={activeGoalId}
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
                              </div>
                            </div>

                            {task.description ? (
                              <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:var(--muted-foreground)]">
                                {task.description}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="hidden flex-wrap gap-2 xl:flex">
                        <Badge tone={getTaskStatusTone(task.status)}>
                          {formatTaskToken(task.status)}
                        </Badge>
                        <Badge tone="muted">{formatTaskToken(task.priority)}</Badge>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 border-t border-[var(--border)] pt-4 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start">
                      <div className="grid min-w-32 gap-1 rounded-[0.9rem] border border-[var(--border)] bg-white/70 px-3 py-3">
                        <p className="glass-label text-etch">Tracked</p>
                        <p className="text-sm font-medium text-[color:var(--foreground)]">
                          {formatDurationLabel(taskTotalDurations[task.id] ?? 0)}
                        </p>
                      </div>

                      <InlineTaskUpdateForm
                        action={updateTaskInlineAction}
                        taskId={task.id}
                        returnTo={returnPath}
                        defaultStatus={task.status}
                        defaultPriority={task.priority}
                        error={inlineError}
                      />
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
