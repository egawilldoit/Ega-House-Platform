import type { Metadata } from "next";
import Link from "next/link";
import { Folder } from "lucide-react";

import {
  createAuthenticatedActor,
  getProjectsReadModel,
  type AreaRecord,
  type ProjectCardReadModel,
} from "@ega/application";
import {
  DEFAULT_AREA_COLOR,
  DEFAULT_AREA_ICON,
  isAreaColor,
  isAreaIcon,
} from "@ega/domain";
import { SupabaseProjectsRepository } from "@ega/data-access";

import { AppShell } from "@/components/layout/app-shell";
import { AreaColorDot, AreaIconView } from "@/components/projects/area-icon";
import { SettingsNav } from "@/app/settings/_components/settings-nav";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { requireAuthenticatedUser } from "@/lib/services/auth-service";
import { createClient } from "@/lib/supabase/server";

import { createAreaAction, deleteAreaAction, updateAreaAction } from "./actions";
import { AreaForm } from "./area-form";

export const metadata: Metadata = {
  title: "Areas | Settings",
  description: "Group projects into life and work areas.",
};

type AreasSettingsPageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

async function getAreasSettingsModel() {
  const supabase = await createClient();
  const user = await requireAuthenticatedUser({ supabase });
  const actor = createAuthenticatedActor(user.id);
  const repository = new SupabaseProjectsRepository(supabase);

  const result = await getProjectsReadModel(actor, repository, "all");
  if (!result.ok) {
    throw new Error(result.errorMessage);
  }

  return result.data;
}

function openTaskCount(project: ProjectCardReadModel) {
  return Math.max(0, project.taskCount - project.completedTaskCount);
}

function AreaCard({
  area,
  projects,
}: {
  area: AreaRecord;
  projects: ProjectCardReadModel[];
}) {
  const openTasks = projects.reduce((total, project) => total + openTaskCount(project), 0);
  const idPrefix = `area-${area.id}`;
  const icon = isAreaIcon(area.icon) ? area.icon : DEFAULT_AREA_ICON;
  const color = isAreaColor(area.color) ? area.color : DEFAULT_AREA_COLOR;

  return (
    <Card
      label="Area"
      title={area.name}
      action={
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="muted">
            {projects.length} {projects.length === 1 ? "project" : "projects"}
          </Badge>
          <Badge tone="muted">
            {openTasks} open {openTasks === 1 ? "task" : "tasks"}
          </Badge>
        </div>
      }
    >
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex items-center gap-1.5">
            <AreaColorDot color={color} />
            <AreaIconView icon={icon} className="h-4 w-4 text-ega-text-secondary" />
          </span>
          <p className="min-w-0 text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-ega-text-secondary">
            {area.description?.trim() || "No description has been added for this area."}
          </p>
        </div>

        {projects.length ? (
          <ul className="rows" aria-label={`Projects in ${area.name}`}>
            {projects.map((project) => (
              <li key={project.id} className="row">
                <Link
                  href={`/tasks/projects/${project.slug}`}
                  className="row-main"
                >
                  <span className="row-title">{project.name}</span>
                  <span className="row-meta">
                    {openTaskCount(project)} open · {project.taskCount} total tasks
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="surface-empty px-4 py-3 text-[length:var(--text-meta-lg)] text-ega-text-secondary">
            No projects are assigned to this area yet.
          </p>
        )}

        <details className="action-overflow">
          <summary className="btn-instrument btn-instrument-muted inline-flex h-7 cursor-pointer items-center px-2.5 text-xs">
            Edit area
          </summary>
          <div className="action-overflow-menu">
            <AreaForm
              action={updateAreaAction}
              areaId={area.id}
              idPrefix={idPrefix}
              initialValues={{
                name: area.name,
                icon,
                color,
                description: area.description ?? "",
              }}
              submitLabel="Save area"
              pendingLabel="Saving…"
            />
          </div>
        </details>

        <details className="rounded-[var(--radius-md)] border border-[var(--status-overdue-border)] bg-[var(--status-overdue-bg)] p-3">
          <summary className="cursor-pointer text-[length:var(--text-meta-lg)] font-medium text-[color:var(--status-overdue)]">
            Delete area
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-[length:var(--text-meta)] leading-[var(--leading-snug)] text-ega-text-secondary">
              Deleting this area unassigns its {projects.length}{" "}
              {projects.length === 1 ? "project" : "projects"}. Projects, tasks,
              goals and history are kept.
            </p>
            <form action={deleteAreaAction}>
              <input type="hidden" name="areaId" value={area.id} />
              <PendingSubmitButton
                type="submit"
                variant="danger"
                size="sm"
                pendingLabel="Deleting…"
              >
                Delete {area.name}
              </PendingSubmitButton>
            </form>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

export default async function AreasSettingsPage({
  searchParams,
}: AreasSettingsPageProps) {
  const [{ success, error }, model] = await Promise.all([
    searchParams,
    getAreasSettingsModel(),
  ]);
  const { areas, projects } = model;
  const unassignedProjects = projects.filter((project) => !project.areaId);
  const unassignedOpenTasks = unassignedProjects.reduce(
    (total, project) => total + openTaskCount(project),
    0,
  );

  return (
    <AppShell
      title="Settings"
      description="Group projects into life and work areas."
    >
      <div className="flex max-w-4xl flex-col gap-6">
        <SettingsNav active="areas" />

        {success ? (
          <div role="status" className="feedback-block feedback-block-success">
            {success.slice(0, 240)}
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="feedback-block feedback-block-error">
            {error.slice(0, 240)}
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>New area</CardTitle>
            <CardDescription>
              Give a life or work area a name, icon and colour. Projects can then
              be assigned to it from the project directory or project page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AreaForm
              action={createAreaAction}
              idPrefix="new-area"
              initialValues={{
                name: "",
                icon: DEFAULT_AREA_ICON,
                color: DEFAULT_AREA_COLOR,
                description: "",
              }}
              submitLabel="Create area"
              pendingLabel="Creating…"
            />
          </CardContent>
        </Card>

        {unassignedProjects.length ? (
          <Card
            label="Unassigned"
            title="Projects without an area"
            action={
              <Badge tone="warn">
                {unassignedProjects.length}{" "}
                {unassignedProjects.length === 1 ? "project" : "projects"}
              </Badge>
            }
          >
            <CardContent className="flex flex-col gap-3">
              <p className="text-[length:var(--text-meta-lg)] text-ega-text-secondary">
                {unassignedOpenTasks} open{" "}
                {unassignedOpenTasks === 1 ? "task" : "tasks"} remain visible in
                the project directory Unassigned group.
              </p>
              <Link
                href="/tasks/projects?area=unassigned"
                className="text-[length:var(--text-body)] font-medium underline-offset-2 hover:underline"
              >
                Review unassigned projects
              </Link>
            </CardContent>
          </Card>
        ) : null}

        {areas.length ? (
          <section aria-label="Areas" className="flex flex-col gap-4">
            {areas.map((area) => (
              <AreaCard
                key={area.id}
                area={area}
                projects={projects.filter((project) => project.areaId === area.id)}
              />
            ))}
          </section>
        ) : (
          <Card>
            <EmptyState
              icon={Folder}
              title="No areas yet"
              description="Create your first area above, then assign projects from the project directory."
            />
          </Card>
        )}
      </div>
    </AppShell>
  );
}
