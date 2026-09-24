import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  createAuthenticatedActor,
  getProjectIdentityReadModel,
  getProjectPurgePreview,
} from "@ega/application";
import { SupabaseProjectsRepository } from "@ega/data-access";

import { purgeProjectAction } from "@/app/tasks/projects/actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import {
  isProjectArchivedStatus,
  normalizeProjectViewFilter,
} from "@/lib/project-archive";
import { requireAuthenticatedUser } from "@/lib/services/auth-service";
import { createClient } from "@/lib/supabase/server";

type ProjectDeletePageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    view?: string;
    purgeError?: string;
  }>;
};

function formatCount(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export default async function ProjectDeletePage({
  params,
  searchParams,
}: ProjectDeletePageProps) {
  const [{ slug }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const activeView = normalizeProjectViewFilter(resolvedSearchParams.view);
  const purgeError = resolvedSearchParams.purgeError?.slice(0, 240) ?? null;

  const supabase = await createClient();
  const user = await requireAuthenticatedUser({ supabase });
  const actor = createAuthenticatedActor(user.id);
  const repository = new SupabaseProjectsRepository(supabase);

  const identityResult = await getProjectIdentityReadModel(actor, repository, slug);

  if (!identityResult.ok) {
    throw new Error(identityResult.errorMessage);
  }

  if (!identityResult.data) {
    notFound();
  }

  const { project } = identityResult.data;

  if (!isProjectArchivedStatus(project.status)) {
    redirect(
      activeView === "active"
        ? `/tasks/projects/${project.slug}`
        : `/tasks/projects/${project.slug}?view=${activeView}`,
    );
  }

  const previewResult = await getProjectPurgePreview(actor, repository, {
    projectId: project.id,
  });

  const projectsHref =
    activeView === "active" ? "/tasks/projects" : `/tasks/projects?view=${activeView}`;

  if (!previewResult.ok) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-10">
        <Card label="Deletion" title="Unable to load deletion impact">
          <CardContent className="flex flex-col gap-3">
            <p role="alert" className="feedback-block feedback-block-error">
              {previewResult.errorMessage}
            </p>
            <Link
              href={projectsHref}
              className="text-[length:var(--text-body)] font-medium text-ega-text-secondary hover:text-ega-text"
            >
              Back to projects
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!previewResult.data) {
    notFound();
  }

  const preview = previewResult.data;
  const impact = {
    taskCount: preview.taskCount,
    goalCount: preview.goalCount,
    sessionCount: preview.sessionCount,
    activeSessionCount: preview.activeSessionCount,
    reminderCount: preview.reminderCount,
    recurrenceCount: preview.recurrenceCount,
    externalRefCount: preview.externalRefCount,
    taskNotificationCount: preview.taskNotificationCount,
    calendarEventCount: preview.calendarEventCount,
  };

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-10">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="warn">Archived</Badge>
          <span className="glass-label">Permanent deletion</span>
        </div>
        <h1 className="text-[length:var(--text-page)] font-semibold tracking-[var(--tracking-tight)] text-ega-text">
          Delete {preview.projectName} permanently?
        </h1>
        <p className="text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-ega-text-secondary">
          Deleting “{preview.projectName}” will permanently remove its project-owned records. This
          surface is the only path to project purge.
        </p>
      </header>

      <Card label="Impact" title="What will be removed">
        <CardContent className="flex flex-col gap-4">
          <ul className="list-disc space-y-1 pl-5 text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-ega-text">
            <li>{formatCount(impact.taskCount, "task", "tasks")}</li>
            <li>{formatCount(impact.goalCount, "goal", "goals")}</li>
            <li>
              {formatCount(impact.sessionCount, "timer session", "timer sessions")}
              {impact.activeSessionCount > 0
                ? ` (${formatCount(impact.activeSessionCount, "timer", "timers")} still running — purging will stop and remove them)`
                : null}
            </li>
            <li>{formatCount(impact.reminderCount, "reminder", "reminders")}</li>
            <li>{formatCount(impact.recurrenceCount, "recurring schedule", "recurring schedules")}</li>
            <li>{formatCount(impact.taskNotificationCount, "task notification", "task notifications")}</li>
            {impact.calendarEventCount > 0 ? (
              <li>
                {formatCount(impact.calendarEventCount, "linked calendar event", "linked calendar events")}{" "}
                will be scheduled for removal
              </li>
            ) : null}
          </ul>

          <p className="text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-ega-text-secondary">
            Ideas and saved task views will be preserved but unlinked.
          </p>

          <p className="feedback-block feedback-block-error">This cannot be undone.</p>
        </CardContent>
      </Card>

      <Card label="Confirmation" title="Confirm deletion">
        <CardContent className="flex flex-col gap-4">
          {purgeError ? (
            <p role="alert" className="feedback-block feedback-block-error">
              {purgeError}
            </p>
          ) : null}

          <form action={purgeProjectAction} className="flex flex-col gap-4">
            <input type="hidden" name="projectId" value={project.id} />
            <input type="hidden" name="slug" value={project.slug} />
            <input type="hidden" name="expectedTaskCount" value={impact.taskCount} />
            <input type="hidden" name="expectedGoalCount" value={impact.goalCount} />
            <input type="hidden" name="returnTo" value={projectsHref} />

            <label className="flex flex-col gap-1.5">
              <span className="text-[length:var(--text-body)] font-medium text-ega-text">
                Type {preview.projectName} to confirm
              </span>
              <input
                type="text"
                name="confirmationName"
                autoComplete="off"
                className="input-instrument h-8 w-full px-2.5 text-[length:var(--text-meta-lg)]"
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <PendingSubmitButton type="submit" variant="danger" size="sm" pendingLabel="Deleting…">
                Purge project permanently
              </PendingSubmitButton>
              <Link
                href={projectsHref}
                className="btn-instrument btn-instrument-muted inline-flex h-7 items-center px-2.5 text-xs"
              >
                Cancel
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
