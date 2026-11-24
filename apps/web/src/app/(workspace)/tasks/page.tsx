import type { Metadata } from "next";
import Link from "next/link";
import { FolderKanban } from "lucide-react";

import { TasksWorkspaceShell } from "@/components/tasks/tasks-workspace-shell";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getWebUserPreferences } from "@/lib/services/user-preferences-service";
import { toggleFavoriteAction } from "@/app/(workspace)/favorites/actions";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getTasksPageModel } from "./_lib/tasks-page-model";
import { TasksPageView } from "./_components/TasksPageView";
import { getWebCalendarSyncStatus } from "@/lib/services/calendar-sync-engine";

export const metadata: Metadata = {
  title: "Tasks",
  description: "Organize, prioritize, and move work forward from one clear execution queue.",
};

type TasksPageProps = {
  searchParams: Promise<{
    status?: string;
    project?: string;
    goal?: string;
    due?: string;
    sort?: string;
    priority?: string;
    estimateMin?: string;
    estimateMax?: string;
    dueWithin?: string;
    tasks?: string;
    archive?: string;
    layout?: string;
    density?: string;
    view?: string;
    cal?: string;
    date?: string;
    dateField?: string;
    taskUpdateError?: string;
    taskUpdateSuccess?: string;
    taskUpdateTaskId?: string;
    /** Selected task for the detail drawer. */
    task?: string;
    /** `full` renders the detail full page instead of a side panel. */
    taskMode?: string;
    /** Workbench tab: active, inbox, or archived. */
    tab?: string;
    /** Legacy saved-view deep link; ignored and falls back to Active. */
    savedView?: string;
    /** Timeline window anchor and week/month zoom. */
    tlStart?: string;
    tlZoom?: string;
    statusUpdateError?: string;
    viewError?: string;
    viewSuccess?: string;
    success?: string;
    error?: string;
  }>;
};

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const resolvedSearchParams = await searchParams;
  const [user, preferences] = await Promise.all([
    getCurrentUser(),
    getWebUserPreferences(),
  ]);
  const model = await getTasksPageModel(resolvedSearchParams, {
    defaultLayout: preferences.taskLayout,
  });
  const calendarStatusResult = await getWebCalendarSyncStatus(
    process.env.APP_URL?.trim() || "http://localhost",
  ).catch(() => null);
  const calendarSyncStatus =
    calendarStatusResult?.ok === true
      ? calendarStatusResult.data
      : {
          connection: {
            connected: false,
            needsReconnect: false,
            accountEmail: null,
            calendarId: "primary",
            destinationKey: "unknown-account|primary",
          },
          run: null,
          pausedRun: null,
          message: null,
          continuationBlocked: false,
          statusErrors: {
            connection:
              calendarStatusResult?.ok === false
                ? calendarStatusResult.errorMessage
                : null,
            run: null,
            pausedRun: null,
          },
        };
  const calendarOAuthNotice = resolvedSearchParams.error
    ? { tone: "error" as const, message: resolvedSearchParams.error.slice(0, 180) }
    : resolvedSearchParams.success
      ? {
          tone: "success" as const,
          message: resolvedSearchParams.success.slice(0, 180),
        }
      : null;

  return (
    <TasksWorkspaceShell
      title="Tasks"
      description="Find, organize, and move your work forward."
      actions={
        <Link
          href="/tasks/projects"
          className={cn(buttonVariants({ variant: "secondary", size: "md" }), "gap-2")}
        >
          <FolderKanban className="h-4 w-4" aria-hidden="true" />
          Projects
        </Link>
      }
    >
      <TasksPageView
        model={model}
        ownerId={user?.id ?? null}
        favouriteAction={toggleFavoriteAction}
        calendarSyncStatus={calendarSyncStatus}
        calendarOAuthNotice={calendarOAuthNotice}
      />
    </TasksWorkspaceShell>
  );
}
