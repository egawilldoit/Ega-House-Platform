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
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
      <div className="mx-auto w-full max-w-2xl space-y-4 p-6">
        <Card>
          <CardContent className="space-y-3 p-6">
            <h1 className="text-lg font-semibold">Unable to load deletion impact</h1>
            <p className="feedback-block feedback-block-error">{previewResult.errorMessage}</p>
            <Link href={projectsHref} className="text-sm underline">
              Back to projects
            </Link>
          </CardContent>
        </Card>
      </div>
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
    <div className="mx-auto w-full max-w-2xl space-y-4 p-6">
      <div className="flex items-center gap-2">
        <Badge>Archived</Badge>
        <h1 className="text-xl font-semibold">Delete {preview.projectName} permanently?</h1>
      </div>

      <Card>
        <CardContent className="space-y-4 p-6">
          <p className="text-sm leading-6">
            Deleting “{preview.projectName}” will permanently remove:
          </p>

          <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
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

          <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">
            Ideas and saved task views will be preserved but unlinked.
          </p>

          <p className="feedback-block feedback-block-error">This cannot be undone.</p>

          {purgeError ? (
            <p className="feedback-block feedback-block-error">{purgeError}</p>
          ) : null}

          <form action={purgeProjectAction} className="space-y-3">
            <input type="hidden" name="projectId" value={project.id} />
            <input type="hidden" name="slug" value={project.slug} />
            <input type="hidden" name="expectedTaskCount" value={impact.taskCount} />
            <input type="hidden" name="expectedGoalCount" value={impact.goalCount} />
            <input type="hidden" name="returnTo" value={projectsHref} />
            <label className="block space-y-2">
              <span className="glass-label text-etch">
                Type {preview.projectName} to confirm
              </span>
              <input
                type="text"
                name="confirmationName"
                autoComplete="off"
                className="input-instrument min-h-9 w-full px-3 py-0 text-sm"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="danger" size="sm">
                Purge project permanently
              </Button>
              <Link
                href={projectsHref}
                className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-xs"
              >
                Cancel
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
