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
    /** Timeline window anchor and week/month zoom. */
    tlStart?: string;
    tlZoom?: string;
    statusUpdateError?: string;
    viewError?: string;
    viewSuccess?: string;
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
      <TasksPageView model={model} ownerId={user?.id ?? null} favouriteAction={toggleFavoriteAction} />
    </TasksWorkspaceShell>
  );
}
