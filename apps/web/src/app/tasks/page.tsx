import type { Metadata } from "next";
import Link from "next/link";
import { FolderKanban } from "lucide-react";

import { TasksWorkspaceShell } from "@/components/tasks/tasks-workspace-shell";
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
    view?: string;
    taskUpdateError?: string;
    taskUpdateSuccess?: string;
    taskUpdateTaskId?: string;
    statusUpdateError?: string;
    viewError?: string;
    viewSuccess?: string;
  }>;
};

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const resolvedSearchParams = await searchParams;
  const model = await getTasksPageModel(resolvedSearchParams);

  return (
    <TasksWorkspaceShell
      eyebrow="Work"
      title="Tasks"
      description="High-density inventory — filter, sort, move work forward."
      className="ega-glass-workspace"
      actions={
        <Link
          href="/tasks/projects"
          className="btn-instrument btn-instrument-muted ega-glass-pill flex h-10 items-center gap-2 rounded-xl px-4 text-sm"
        >
          <FolderKanban className="h-4 w-4" aria-hidden="true" />
          Projects
        </Link>
      }
    >
      <TasksPageView model={model} />
    </TasksWorkspaceShell>
  );
}
