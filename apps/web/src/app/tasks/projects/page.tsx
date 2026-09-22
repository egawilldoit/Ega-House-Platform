import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown, FolderKanban, Plus } from "lucide-react";

import {
  createAuthenticatedActor,
  getProjectsReadModel,
  type ProjectCardReadModel,
} from "@ega/application";
import { SupabaseProjectsRepository } from "@ega/data-access";

import {
  archiveProjectAction,
  unarchiveProjectAction,
  updateProjectStatusAction,
} from "@/app/tasks/projects/actions";
import { InlineProjectStatusForm } from "@/components/projects/inline-project-status-form";
import { TasksWorkspaceShell } from "@/components/tasks/tasks-workspace-shell";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterPill } from "@/components/ui/filter-pill";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatCard } from "@/components/ui/stat-card";
import {
  type ProjectViewFilter,
  isProjectArchivedStatus,
  normalizeProjectViewFilter,
} from "@/lib/project-archive";
import { requireAuthenticatedUser } from "@/lib/services/auth-service";
import { createClient } from "@/lib/supabase/server";
import { formatTaskToken, getTaskStatusTone } from "@/lib/task-domain";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Projects | Tasks",
  description: "Projects list with task context for the tasks workspace.",
};

const PROJECT_VIEWS = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
] as const;

function getProjectViewHref(view: ProjectViewFilter) {
  return `/tasks/projects?view=${view}`;
}

async function getProjectsWithTaskContext(view: ProjectViewFilter) {
  const supabase = await createClient();
  const user = await requireAuthenticatedUser({ supabase });
  const actor = createAuthenticatedActor(user.id);
  const repository = new SupabaseProjectsRepository(supabase);

  const result = await getProjectsReadModel(actor, repository, view);

  if (!result.ok) {
    throw new Error(result.errorMessage);
  }

  return result.data;
}

function ProjectRow({
  project,
  returnTo,
  inlineError,
  archiveError,
  activeView,
}: {
  project: ProjectCardReadModel;
  returnTo: string;
  inlineError?: string | null;
  archiveError?: string | null;
  activeView: ProjectViewFilter;
}) {
  const isArchived = isProjectArchivedStatus(project.status);
  const openTaskCount = project.taskCount - project.completedTaskCount;
  const openStatusCounts = project.statusCounts.filter((entry) => entry.status !== "done");
  const detailHref = `/tasks/projects/${project.slug}${
    activeView === "active" ? "" : `?view=${activeView}`
  }`;
  const deleteHref = `/tasks/projects/${project.slug}/delete${
    activeView === "active" ? "" : `?view=${activeView}`
  }`;

  return (
    <tr id={`project-${project.id}`} className="scroll-mt-24">
      <td>
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={detailHref}
            className="truncate text-[length:var(--text-body)] font-medium text-[color:var(--ega-text)] hover:underline"
          >
            {project.name}
          </Link>
          <span className="hidden truncate text-[length:var(--text-meta)] text-ega-text-tertiary md:inline">
            {project.slug}
          </span>
        </div>
        <span className="mt-1 flex flex-wrap items-center gap-1.5 sm:hidden">
          <Badge tone={getTaskStatusTone(project.status)}>
            {formatTaskToken(project.status)}
          </Badge>
          {isArchived ? <Badge tone="warn">Archived</Badge> : null}
        </span>
      </td>

      <td className="hidden sm:table-cell">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={getTaskStatusTone(project.status)}>
            {formatTaskToken(project.status)}
          </Badge>
          {isArchived ? <Badge tone="warn">Archived</Badge> : null}
        </div>
      </td>

      <td className="hidden lg:table-cell">
        {project.taskCount === 0 ? (
          <span className="text-[length:var(--text-meta-lg)] text-ega-text-tertiary">
            No tasks
          </span>
        ) : openTaskCount === 0 ? (
          <span className="text-[length:var(--text-meta-lg)] text-ega-text-secondary">
            All tasks done
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[length:var(--text-meta-lg)] font-medium tabular-nums text-ega-text">
              {openTaskCount} open
            </span>
            {openStatusCounts.map((entry) => (
              <Badge key={entry.status} tone={getTaskStatusTone(entry.status)}>
                {entry.count} {formatTaskToken(entry.status)}
              </Badge>
            ))}
          </div>
        )}
      </td>

      <td className="hidden md:table-cell">
        <div className="flex items-center gap-2">
          <div className="w-16 shrink-0">
            <ProgressBar value={project.progressPercent} />
          </div>
          <span className="text-[length:var(--text-meta-lg)] font-medium tabular-nums text-ega-text">
            {project.progressPercent}%
          </span>
          <span className="text-[length:var(--text-meta)] tabular-nums text-ega-text-tertiary">
            {project.completedTaskCount}/{project.taskCount}
          </span>
        </div>
      </td>

      <td className="hidden whitespace-nowrap tabular-nums text-ega-text-secondary xl:table-cell">
        {new Date(project.updatedAt).toLocaleDateString("en-US")}
      </td>

      <td className="w-[92px]">
        <div className="flex flex-col items-end gap-2">
          {inlineError ? (
            <p role="alert" className="feedback-block feedback-block-error">
              {inlineError}
            </p>
          ) : null}
          {archiveError ? (
            <p role="alert" className="feedback-block feedback-block-error">
              {archiveError}
            </p>
          ) : null}

          <details className="action-overflow">
            <summary className="btn-instrument btn-instrument-muted flex h-7 cursor-pointer items-center gap-1 px-2.5 text-xs">
              <span className="hidden sm:inline">Actions</span>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only sm:hidden">Actions</span>
            </summary>
            <div className="action-overflow-menu flex flex-col gap-3">
              {isArchived ? (
                <p className="text-[length:var(--text-meta)] leading-[var(--leading-snug)] text-ega-text-secondary">
                  Archived projects stay available for reference. Restore the project to change its
                  status.
                </p>
              ) : (
                <InlineProjectStatusForm
                  action={updateProjectStatusAction}
                  projectId={project.id}
                  returnTo={returnTo}
                  defaultStatus={project.status}
                />
              )}

              <form action={isArchived ? unarchiveProjectAction : archiveProjectAction}>
                <input type="hidden" name="projectId" value={project.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <Button
                  type="submit"
                  variant={isArchived ? "secondary" : "danger"}
                  size="sm"
                  className="w-full justify-center"
                >
                  {isArchived ? "Unarchive project" : "Archive project"}
                </Button>
              </form>

              {isArchived ? (
                <Link
                  href={deleteHref}
                  className={cn(buttonVariants({ variant: "danger", size: "sm" }), "w-full justify-center")}
                >
                  Delete permanently
                </Link>
              ) : null}
            </div>
          </details>
        </div>
      </td>
    </tr>
  );
}

function ProjectsEmptyState({
  hasArchivedProjects,
}: {
  hasArchivedProjects: boolean;
}) {
  return (
    <EmptyState
      icon={FolderKanban}
      title="No projects yet"
      description={
        hasArchivedProjects
          ? "Archived projects are hidden from the default view. Switch to Archived or All to inspect them."
          : "No project rows exist yet. Create one to start attaching goals and tasks."
      }
      action={
        <Link
          href="/tasks/projects/new"
          className="btn-instrument btn-instrument-muted inline-flex h-8 items-center px-3 text-xs"
        >
          Create first project
        </Link>
      }
    />
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
      title="Projects"
      description="Project directory — status, active work, progress, and recency."
      actions={
        <Link
          href="/tasks/projects/new"
          className={cn(buttonVariants({ variant: "primary" }), "flex h-8 items-center gap-2 px-3")}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New project
        </Link>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="kpi-grid">
          <StatCard
            label="Projects"
            value={totalProjects}
            subtitle={`${archivedProjects} archived`}
          />
          <StatCard label="Active" value={activeProjects} subtitle="status active" />
          <StatCard label="Completed" value={completedProjects} subtitle="status done" />
        </div>

        <Card flush>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>Project directory</CardTitle>
                <CardDescription className="mt-1">
                  {projects.length} shown · {totalProjects} total · {archivedProjects} archived
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Project views">
                {PROJECT_VIEWS.map((view) => (
                  <FilterPill
                    key={view.value}
                    label={view.label}
                    href={getProjectViewHref(view.value)}
                    active={activeView === view.value}
                    ariaCurrent={activeView === view.value ? "page" : undefined}
                  />
                ))}
              </div>
            </div>
          </CardHeader>
          {projects.length ? (
            <table className="data-table table-fixed">
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col" className="hidden sm:table-cell">
                    Status
                  </th>
                  <th scope="col" className="hidden lg:table-cell">
                    Active work
                  </th>
                  <th scope="col" className="hidden md:table-cell">
                    Progress
                  </th>
                  <th scope="col" className="hidden xl:table-cell">
                    Updated
                  </th>
                  <th scope="col" className="w-[92px] text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <ProjectRow
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
              </tbody>
            </table>
          ) : (
            <ProjectsEmptyState hasArchivedProjects={archivedProjects > 0} />
          )}
        </Card>
      </div>
    </TasksWorkspaceShell>
  );
}
