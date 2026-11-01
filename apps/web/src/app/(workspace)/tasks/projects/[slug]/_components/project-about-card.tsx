import Link from "next/link";

import type { AreaRecord, ProjectRecord } from "@ega/application";

import {
  archiveProjectAction,
  assignProjectAreaAction,
  unarchiveProjectAction,
  updateProjectStatusAction,
} from "@/app/(workspace)/tasks/projects/actions";
import { AreaColorDot, AreaIconView } from "@/components/projects/area-icon";
import { InlineProjectStatusForm } from "@/components/projects/inline-project-status-form";
import { ProjectAreaForm } from "@/components/projects/project-area-form";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { formatTaskToken, getTaskStatusTone } from "@/lib/task-domain";
import { formatTimerDateTime } from "@/lib/timer-domain";
import { cn } from "@/lib/utils";

type ProjectAboutCardProps = {
  project: ProjectRecord;
  goalsCount: number;
  areas: AreaRecord[];
  activeTaskCount: number;
  completedTaskCount: number;
  archivedTaskCount: number;
  projectIsArchived: boolean;
  returnTo: string;
  deleteHref: string;
  statusError: string | null;
  archiveError: string | null;
  areaError: string | null;
};

export function ProjectAboutCard({
  project,
  goalsCount,
  areas,
  activeTaskCount,
  completedTaskCount,
  archivedTaskCount,
  projectIsArchived,
  returnTo,
  deleteHref,
  statusError,
  archiveError,
  areaError,
}: ProjectAboutCardProps) {
  return (
    <Card
      label="About"
      title="Project details"
      action={
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={getTaskStatusTone(project.status)}>
            {formatTaskToken(project.status)}
          </Badge>
          {projectIsArchived ? <Badge tone="warn">Archived</Badge> : null}
          {project.areaName ? (
            <Badge tone="info">
              <AreaColorDot color={project.areaColor} />
              {project.areaName}
            </Badge>
          ) : (
            <Badge tone="muted">No area</Badge>
          )}
        </div>
      }
    >
      <CardContent className="flex flex-col gap-4">
        <p className="max-w-[80ch] text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-ega-text-secondary">
          {project.description?.trim() ||
            "No description has been added for this project yet."}
        </p>

        <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[color:var(--ega-surface-subtle)] p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="glass-label">Area</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[length:var(--text-body)] font-medium text-ega-text">
              {project.areaName ? (
                <>
                  <AreaColorDot color={project.areaColor} />
                  <AreaIconView icon={project.areaIcon} />
                  {project.areaName}
                </>
              ) : (
                "No area"
              )}
              <Link
                href={
                  project.areaId
                    ? `/tasks/projects?area=${project.areaId}`
                    : "/tasks/projects?area=unassigned"
                }
                className="text-[length:var(--text-meta)] font-normal text-ega-text-secondary underline-offset-2 hover:underline"
              >
                View in directory
              </Link>
            </p>
          </div>
          <div className="w-full sm:w-56">
            <ProjectAreaForm
              action={assignProjectAreaAction}
              projectId={project.id}
              currentAreaId={project.areaId}
              areas={areas}
              returnTo={returnTo}
              error={areaError}
              compact
            />
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <dt className="glass-label">Status</dt>
            <dd className="mt-1 text-[length:var(--text-body)] text-ega-text">
              {formatTaskToken(project.status)}
            </dd>
          </div>
          <div>
            <dt className="glass-label">Created</dt>
            <dd className="mt-1 text-[length:var(--text-body)] text-ega-text">
              {formatTimerDateTime(project.createdAt)}
            </dd>
          </div>
          <div>
            <dt className="glass-label">Goals</dt>
            <dd className="mt-1 text-[length:var(--text-body)] text-ega-text">{goalsCount}</dd>
          </div>
          <div>
            <dt className="glass-label">Tasks</dt>
            <dd className="mt-1 text-[length:var(--text-body)] text-ega-text">
              {activeTaskCount} active
              {completedTaskCount > 0 ? ` · ${completedTaskCount} done` : ""}
              {archivedTaskCount > 0 ? ` · ${archivedTaskCount} archived` : ""}
            </dd>
          </div>
        </dl>
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
              error={statusError}
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
              <PendingSubmitButton
                type="submit"
                variant={projectIsArchived ? "secondary" : "danger"}
                size="sm"
                pendingLabel={projectIsArchived ? "Unarchiving…" : "Archiving…"}
              >
                {projectIsArchived ? "Unarchive project" : "Archive project"}
              </PendingSubmitButton>
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
  );
}
