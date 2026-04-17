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
import { Card, CardContent } from "@/components/ui/card";
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
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="border-[var(--border)] bg-white">
          <CardContent className="p-6">
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <p className="glass-label text-etch">Active Execution Queue</p>
                <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                  {tasks.length} item{tasks.length !== 1 ? "s" : ""} in the current task slice.
                </p>
              </div>
            </div>

            <div className="mb-6">
              <TaskFilterControls
                basePath="/tasks"
                activeStatus={activeStatus}
                activeProjectId={activeProjectId}
                activeGoalId={activeGoalId}
                projectOptions={projects}
                goalOptions={goals.map((goal) => ({ id: goal.id, title: goal.title }))}
              />
            </div>

            {tasks.length === 0 ? (
              <div className="surface-empty px-5 py-8 text-center">
                <p className="glass-label text-etch">No tasks match current filters</p>
                <p className="mt-2 text-sm leading-6 text-[color:var(--muted-foreground)]">
                  Reset one or more filters to bring the execution queue back into view.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {tasks.map((task) => {
                  const inlineError = taskUpdateTaskId === task.id ? taskUpdateError : null;

                  return (
                    <article
                      key={task.id}
                      id={`task-${task.id}`}
                      className="scroll-mt-24 rounded-sm border border-[var(--border)] bg-[color:var(--instrument-raised)] px-4 py-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start gap-3">
                            <span
                              className={`mt-2 h-2 w-2 shrink-0 rounded-full ${getTaskSignalTone(
                                task.status,
                                task.priority,
                              )}`}
                            />
                            <div className="min-w-0">
                              <h2 className="truncate text-base font-medium text-[color:var(--foreground)]">
                                {task.title}
                              </h2>
                              <p className="mt-1 text-[0.625rem] uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                                {task.projects?.name ?? "No project"}
                                {task.goals?.title ? ` · ${task.goals.title}` : ""}
                              </p>
                              {task.description ? (
                                <p className="mt-3 line-clamp-2 text-sm leading-6 text-[color:var(--muted-foreground)]">
                                  {task.description}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Badge tone={getTaskStatusTone(task.status)}>
                            {formatTaskToken(task.status)}
                          </Badge>
                          <Badge tone="muted">{formatTaskToken(task.priority)}</Badge>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-start justify-between gap-4 border-t border-[var(--border)] pt-4">
                        <div className="space-y-1 pt-1">
                          <p className="glass-label text-etch">Tracked</p>
                          <p className="text-sm text-[color:var(--foreground)]">
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
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-[var(--border)] bg-white">
          <CardContent className="p-6">
            <div className="mb-5">
              <p className="glass-label text-signal-live">Initialize Task</p>
              <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                Open a new task directly into the current execution surface.
              </p>
            </div>

            {projects.length === 0 ? (
              <div className="space-y-3">
                <div className="surface-empty px-4 py-5 text-center">
                  <p className="glass-label text-etch">No projects yet. Create one first.</p>
                </div>
                <Link
                  href="/tasks/projects/new"
                  className="btn-instrument flex h-8 items-center justify-center px-4"
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
    </TasksWorkspaceShell>
  );
}
