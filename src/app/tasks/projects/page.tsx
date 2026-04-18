import type { Metadata } from "next";
import Link from "next/link";

import {
  archiveProjectAction,
  unarchiveProjectAction,
  updateProjectStatusAction,
} from "@/app/tasks/projects/actions";
import { InlineProjectStatusForm } from "@/components/projects/inline-project-status-form";
import { TasksWorkspaceShell } from "@/components/tasks/tasks-workspace-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  type ProjectViewFilter,
  PROJECT_ARCHIVE_STATUS,
  isProjectArchivedStatus,
  normalizeProjectViewFilter,
} from "@/lib/project-archive";
import { createClient } from "@/lib/supabase/server";
import { formatTaskToken, getTaskStatusTone } from "@/lib/task-domain";
import type { Tables } from "@/lib/supabase/database.types";

type ProjectRow = Pick<
  Tables<"projects">,
  "id" | "name" | "slug" | "description" | "status" | "created_at" | "updated_at"
>;

type TaskRow = Pick<
  Tables<"tasks">,
  "id" | "project_id" | "title" | "status" | "priority" | "updated_at"
>;

type ProjectCardData = ProjectRow & {
  taskCount: number;
  completedTaskCount: number;
  progressPercent: number;
  statusCounts: Array<{ status: string; count: number }>;
  recentTasks: TaskRow[];
};

type ProjectSummary = {
  total: number;
  active: number;
  completed: number;
  archived: number;
};

export const metadata: Metadata = {
  title: "Projects | Tasks | EGA House",
  description: "Projects list with task context for the tasks workspace.",
};

function formatStatusLabel(status: string) {
  return status
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (value) => value.toUpperCase());
}

function formatPriorityLabel(priority: string) {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

function getStatusTone(status: string) {
  return getTaskStatusTone(status);
}

function getProjectProgressTone(project: ProjectCardData) {
  if (project.status === "done") {
    return "bg-[var(--signal-live)] text-signal-live";
  }

  if (project.status === "paused") {
    return "bg-[var(--etch)] text-etch";
  }

  if (project.progressPercent < 20 && project.taskCount > 0) {
    return "bg-[var(--signal-error)] text-signal-error";
  }

  return "bg-[var(--signal-info)] text-[var(--signal-info)]";
}

async function getProjectsWithTaskContext(view: ProjectViewFilter) {
  const supabase = await createClient();
  const projectsQuery = supabase
    .from("projects")
    .select("id, name, slug, description, status, created_at, updated_at")
    .order("updated_at", { ascending: false });

  if (view === "active") {
    projectsQuery.neq("status", PROJECT_ARCHIVE_STATUS);
  } else if (view === "archived") {
    projectsQuery.eq("status", PROJECT_ARCHIVE_STATUS);
  }

  const [{ data: projects, error: projectsError }, { data: projectSummaryRows, error: projectSummaryError }] =
    await Promise.all([projectsQuery, supabase.from("projects").select("status")]);

  if (projectsError) {
    throw new Error(`Failed to load projects: ${projectsError.message}`);
  }

  if (projectSummaryError) {
    throw new Error(`Failed to load project summary: ${projectSummaryError.message}`);
  }

  const summary: ProjectSummary = {
    total: projectSummaryRows.length,
    active: projectSummaryRows.filter((project) => project.status === "active").length,
    completed: projectSummaryRows.filter((project) => project.status === "done").length,
    archived: projectSummaryRows.filter((project) => isProjectArchivedStatus(project.status)).length,
  };

  if (!projects.length) {
    return { projects: [], summary };
  }

  const projectIds = projects.map((project) => project.id);
  const { data: tasks, error: tasksError } = await supabase
    .from("tasks")
    .select("id, project_id, title, status, priority, updated_at")
    .in("project_id", projectIds)
    .order("updated_at", { ascending: false });

  if (tasksError) {
    throw new Error(`Failed to load task context: ${tasksError.message}`);
  }

  const tasksByProject = new Map<string, TaskRow[]>();

  for (const task of tasks) {
    const projectTasks = tasksByProject.get(task.project_id) ?? [];
    projectTasks.push(task);
    tasksByProject.set(task.project_id, projectTasks);
  }

  return {
    projects: projects.map((project) => {
      const projectTasks = tasksByProject.get(project.id) ?? [];
      const statusCountMap = new Map<string, number>();

      for (const task of projectTasks) {
        statusCountMap.set(task.status, (statusCountMap.get(task.status) ?? 0) + 1);
      }

      const completedTaskCount = projectTasks.filter((task) => task.status === "done").length;
      const progressPercent =
        projectTasks.length > 0
          ? Math.round((completedTaskCount / projectTasks.length) * 100)
          : 0;

      const statusCounts = Array.from(statusCountMap.entries())
        .map(([status, count]) => ({ status, count }))
        .sort((left, right) => right.count - left.count || left.status.localeCompare(right.status))
        .slice(0, 3);

      return {
        ...project,
        taskCount: projectTasks.length,
        completedTaskCount,
        progressPercent,
        statusCounts,
        recentTasks: projectTasks.slice(0, 2),
      } satisfies ProjectCardData;
    }),
    summary,
  };
}

function EmptyState({ hasArchivedProjects }: { hasArchivedProjects: boolean }) {
  return (
    <Card className="surface-empty bg-white max-w-3xl">
      <CardContent className="space-y-5 p-8">
        <Badge tone="info" className="w-fit">
          Projects
        </Badge>
        <div className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
            No projects yet
          </h2>
          <p className="max-w-2xl text-sm leading-7 text-[color:var(--muted-foreground)]">
            {hasArchivedProjects
              ? "Archived projects are hidden from the default view. Switch to Archived or All to inspect them."
              : "The tasks workspace is wired to the live database, but there are no project rows to render yet. Once projects exist, this view will summarize status, completion pressure, and direct task context."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <form action="/tasks/projects/new">
            <Button variant="muted" type="submit">
              Create first project
            </Button>
          </form>
          <p className="text-sm leading-7 text-[color:var(--muted-foreground)]">
            {hasArchivedProjects
              ? "Archived projects remain reachable through explicit project views."
              : "Create one project to start attaching goals and tasks."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectCard({
  project,
  returnTo,
  inlineError,
  archiveError,
  activeView,
}: {
  project: ProjectCardData;
  returnTo: string;
  inlineError?: string | null;
  archiveError?: string | null;
  activeView: ProjectViewFilter;
}) {
  const progressTone = getProjectProgressTone(project);
  const isArchived = isProjectArchivedStatus(project.status);
  const detailHref = `/tasks/projects/${project.slug}${
    activeView === "active" ? "" : `?view=${activeView}`
  }`;

  return (
    <Card
      id={`project-${project.id}`}
      className="h-full scroll-mt-24 border-[var(--border)] bg-white transition hover:border-[var(--border-strong)]"
    >
      <CardContent className="flex h-full flex-col p-6">
        <div className="mb-5 flex items-start justify-between gap-3">
          <Badge tone={getStatusTone(project.status)}>{formatTaskToken(project.status)}</Badge>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {isArchived ? <Badge tone="warn">Archived</Badge> : null}
            <span className="glass-label text-etch">{project.slug}</span>
          </div>
        </div>

        <div className="mb-5 flex-1 space-y-4">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold tracking-tight text-[color:var(--foreground)]">
              <Link href={detailHref} className="transition hover:text-[var(--signal-live)]">
                {project.name}
              </Link>
            </h2>
            <p className="line-clamp-2 text-sm leading-6 text-[color:var(--muted-foreground)]">
              {project.description?.trim() || "No project description added yet."}
            </p>
          </div>

          <div className="flex items-center gap-2 text-sm text-[color:var(--muted-foreground)]">
            <span className="glass-label text-[color:var(--foreground)]">
              {project.completedTaskCount}/{project.taskCount}
            </span>
            <span>tasks completed</span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[color:var(--instrument-raised)]">
              <div
                className={`h-full rounded-full ${progressTone.split(" ")[0]}`}
                style={{ width: `${project.progressPercent}%` }}
              />
            </div>
            <span className={`glass-label ${progressTone.split(" ")[1]}`}>
              {project.progressPercent}%
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {project.statusCounts.length ? (
              project.statusCounts.map((entry) => (
                <Badge key={entry.status} tone={getStatusTone(entry.status)}>
                  {entry.count} {formatStatusLabel(entry.status)}
                </Badge>
              ))
            ) : (
              <Badge>No task activity yet</Badge>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="glass-label text-etch">Recent tasks</p>
              <Link href={detailHref} className="glass-label text-signal-live">
                Open
              </Link>
            </div>

            {project.recentTasks.length ? (
              <div className="space-y-2">
                {project.recentTasks.map((task) => (
                  <div
                    key={task.id}
                    className="rounded-[1rem] border border-[var(--border)] bg-[color:var(--instrument-raised)] px-3 py-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <p className="text-sm font-medium leading-6 text-[color:var(--foreground)]">
                        {task.title}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Badge tone={getStatusTone(task.status)}>
                          {formatStatusLabel(task.status)}
                        </Badge>
                        <Badge>{formatPriorityLabel(task.priority)}</Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="surface-empty px-4 py-4 text-sm leading-7 text-[color:var(--muted-foreground)]">
                No tasks are attached to this project yet.
              </div>
            )}
          </div>
        </div>

        <div className="mt-auto border-t border-[var(--border)] pt-4">
          {!isArchived ? (
            <InlineProjectStatusForm
              action={updateProjectStatusAction}
              projectId={project.id}
              returnTo={returnTo}
              defaultStatus={project.status}
              error={inlineError}
            />
          ) : (
            <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">
              Archived projects stay visible for reference. Linked goals and tasks keep their
              current states until you update those records directly.
            </p>
          )}

          <div className="mt-4 border-t border-[var(--border)] pt-4">
            {archiveError ? <p className="feedback-block feedback-block-error mb-3">{archiveError}</p> : null}
            <form action={isArchived ? unarchiveProjectAction : archiveProjectAction}>
              <input type="hidden" name="projectId" value={project.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <Button type="submit" variant={isArchived ? "muted" : "danger"} size="sm">
                {isArchived ? "Unarchive Project" : "Archive Project"}
              </Button>
            </form>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

type TasksProjectsPageProps = {
  searchParams: Promise<{
    view?: string;
    projectUpdateError?: string;
    projectUpdateProjectId?: string;
    projectUpdateField?: string;
  }>;
};

export default async function TasksProjectsPage({ searchParams }: TasksProjectsPageProps) {
  const resolvedSearchParams = await searchParams;
  const activeView = normalizeProjectViewFilter(resolvedSearchParams.view);
  const projectUpdateError = resolvedSearchParams.projectUpdateError?.slice(0, 180) ?? null;
  const projectUpdateProjectId = resolvedSearchParams.projectUpdateProjectId ?? null;
  const projectUpdateField = resolvedSearchParams.projectUpdateField ?? null;
  const { projects, summary } = await getProjectsWithTaskContext(activeView);
  const totalProjects = summary.total;
  const activeProjects = summary.active;
  const completedProjects = summary.completed;
  const archivedProjects = summary.archived;

  return (
    <TasksWorkspaceShell
      eyebrow="Portfolio Overview"
      title="Projects"
      description="Command index for project status, task pressure, and direct entry into each project workspace."
      actions={
        <form action="/tasks/projects/new">
          <Button type="submit">New Project</Button>
        </form>
      }
    >
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Link
          href="/tasks/projects?view=active"
          className={`glass-label rounded-full px-3 py-1 ${
            activeView === "active"
              ? "border-[rgba(23,123,82,0.28)] bg-[rgba(23,123,82,0.08)] text-signal-live"
              : "text-[color:var(--muted-foreground)]"
          }`}
        >
          Active
        </Link>
        <Link
          href="/tasks/projects?view=archived"
          className={`glass-label rounded-full px-3 py-1 ${
            activeView === "archived"
              ? "border-[rgba(23,123,82,0.28)] bg-[rgba(23,123,82,0.08)] text-signal-live"
              : "text-[color:var(--muted-foreground)]"
          }`}
        >
          Archived
        </Link>
        <Link
          href="/tasks/projects?view=all"
          className={`glass-label rounded-full px-3 py-1 ${
            activeView === "all"
              ? "border-[rgba(23,123,82,0.28)] bg-[rgba(23,123,82,0.08)] text-signal-live"
              : "text-[color:var(--muted-foreground)]"
          }`}
        >
          All
        </Link>
        <Badge tone="muted">{totalProjects} total</Badge>
        <Badge tone={archivedProjects > 0 ? "warn" : "muted"}>{archivedProjects} archived</Badge>
      </div>

      <div className="mb-8 flex flex-wrap items-end justify-between gap-6 border-b border-[var(--border)] pb-6">
        <div className="flex items-center gap-5">
          <div className="text-right">
            <p className="glass-label text-etch">Total</p>
            <p className="text-3xl font-semibold tracking-tight text-[color:var(--foreground)]">
              {totalProjects}
            </p>
          </div>
          <div className="h-12 w-px bg-[var(--border)]" />
          <div className="text-right">
            <p className="glass-label text-signal-live">Active</p>
            <p className="text-3xl font-semibold tracking-tight text-signal-live">
              {activeProjects}
            </p>
          </div>
          <div className="h-12 w-px bg-[var(--border)]" />
          <div className="text-right">
            <p className="glass-label text-etch">Completed</p>
            <p className="text-3xl font-semibold tracking-tight text-[color:var(--foreground)]">
              {completedProjects}
            </p>
          </div>
        </div>
      </div>

      {projects.length ? (
        <div className="grid items-start gap-6 lg:grid-cols-2 2xl:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              returnTo={`/tasks/projects?view=${activeView}`}
              inlineError={
                projectUpdateProjectId === project.id && projectUpdateField === "status"
                  ? projectUpdateError
                  : null
              }
              archiveError={
                projectUpdateProjectId === project.id && projectUpdateField === "archive"
                  ? projectUpdateError
                  : null
              }
              activeView={activeView}
            />
          ))}
        </div>
      ) : (
        <EmptyState hasArchivedProjects={archivedProjects > 0} />
      )}
    </TasksWorkspaceShell>
  );
}
