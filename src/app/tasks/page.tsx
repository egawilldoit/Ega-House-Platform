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
import { Card } from "@/components/ui/card";
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
    supabase.from("goals").select("id, title, project_id").order("created_at", { ascending: false }),
  ]);
  if (projectsResult.error) throw new Error(`Failed to load projects: ${projectsResult.error.message}`);
  if (goalsResult.error) throw new Error(`Failed to load goals: ${goalsResult.error.message}`);
  const activeProjectId = requestedProjectId && projectsResult.data.some((p) => p.id === requestedProjectId) ? requestedProjectId : null;
  const visibleGoals = activeProjectId ? goalsResult.data.filter((g) => g.project_id === activeProjectId) : goalsResult.data;
  const activeGoalId = requestedGoalId && visibleGoals.some((g) => g.id === requestedGoalId) ? requestedGoalId : null;
  const tasksQuery = supabase
    .from("tasks")
    .select("id, title, description, status, priority, updated_at, project_id, goal_id, projects(name), goals(title)")
    .order("updated_at", { ascending: false });
  if (activeStatus) tasksQuery.eq("status", activeStatus);
  if (activeProjectId) tasksQuery.eq("project_id", activeProjectId);
  if (activeGoalId) tasksQuery.eq("goal_id", activeGoalId);
  const tasksResult = await tasksQuery;
  if (tasksResult.error) throw new Error(`Failed to load tasks: ${tasksResult.error.message}`);
  const tasks = tasksResult.data;
  const taskTotalDurations = await getTaskTotalDurationMap(supabase, tasks.map((t) => t.id));
  return { projects: projectsResult.data, goals: visibleGoals, tasks, taskTotalDurations, activeProjectId, activeGoalId };
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const resolvedSearchParams = await searchParams;
  const statusParam = resolvedSearchParams.status;
  const projectParam = resolvedSearchParams.project?.trim() || null;
  const goalParam = resolvedSearchParams.goal?.trim() || null;
  const activeStatus: string | null = statusParam && isTaskStatus(statusParam) ? statusParam : null;
  const taskUpdateError = resolvedSearchParams.taskUpdateError?.slice(0, 180) ?? resolvedSearchParams.statusUpdateError?.slice(0, 180) ?? null;
  const taskUpdateTaskId = resolvedSearchParams.taskUpdateTaskId ?? null;
  const { projects, goals, tasks, taskTotalDurations, activeProjectId, activeGoalId } = await getTasksData(activeStatus, projectParam, goalParam);
  const returnPath = buildTaskFilterReturnPath("/tasks", { status: activeStatus, project: activeProjectId, goal: activeGoalId });

  return (
    <TasksWorkspaceShell
      eyebrow="Tasks · Execution Surface"
      title="Tasks"
      description="Track execution with status and goal filtering, quick status updates, and direct task creation."
      actions={
        <Link href="/tasks/projects" className="btn-instrument btn-instrument-muted glass-label h-8 px-4 flex items-center gap-2">
          Projects →
        </Link>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">

        {/* ── Task table ──────────────────────────────────── */}
        <Card label="Task List" title={`${tasks.length} item${tasks.length !== 1 ? "s" : ""}`}>
          {/* Filters */}
          <div className="mb-5">
            <TaskFilterControls
              basePath="/tasks"
              activeStatus={activeStatus}
              activeProjectId={activeProjectId}
              activeGoalId={activeGoalId}
              goalOptions={goals.map((g) => ({ id: g.id, title: g.title }))}
            />
          </div>

          {tasks.length === 0 ? (
            <div className="py-10 text-center">
              <p className="glass-label text-etch">No tasks match current filters</p>
            </div>
          ) : (
            <table className="instrument-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Project</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Tracked</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const inlineError = taskUpdateTaskId === task.id ? taskUpdateError : null;
                  return (
                    <tr key={task.id} id={`task-${task.id}`} className="scroll-mt-20">
                      <td>
                        <p className="text-sm font-medium truncate max-w-[240px]" style={{ color: "var(--foreground)" }}>
                          {task.title}
                        </p>
                        {task.goals?.title && (
                          <p className="glass-label text-etch mt-0.5">{task.goals.title}</p>
                        )}
                      </td>
                      <td>
                        <span className="glass-label" style={{ color: "var(--muted-foreground)" }}>
                          {task.projects?.name ?? "—"}
                        </span>
                      </td>
                      <td>
                        <Badge tone={getTaskStatusTone(task.status)}>
                          {formatTaskToken(task.status)}
                        </Badge>
                      </td>
                      <td>
                        <Badge tone="muted">{formatTaskToken(task.priority)}</Badge>
                      </td>
                      <td>
                        <span className="glass-label text-etch font-mono tabular">
                          {formatDurationLabel(taskTotalDurations[task.id] ?? 0)}
                        </span>
                      </td>
                      <td>
                        <InlineTaskUpdateForm
                          action={updateTaskInlineAction}
                          taskId={task.id}
                          returnTo={returnPath}
                          defaultStatus={task.status}
                          defaultPriority={task.priority}
                          error={inlineError}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>

        {/* ── Create task ──────────────────────────────────── */}
        <Card label="New Task" title="Create task">
          {projects.length === 0 ? (
            <div className="py-4 space-y-3">
              <p className="glass-label text-etch">No projects yet. Create one first.</p>
              <Link href="/tasks/projects/new" className="btn-instrument glass-label h-8 px-4 flex items-center justify-center">
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
        </Card>

      </div>
    </TasksWorkspaceShell>
  );
}
