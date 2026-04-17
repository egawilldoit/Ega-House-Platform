import { TasksWorkspaceShell } from "@/components/tasks/tasks-workspace-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function ProjectCardSkeleton() {
  return (
    <Card className="border-[var(--border)] bg-[color:var(--instrument)]">
      <CardContent className="flex h-full flex-col p-6">
        <div className="mb-6 flex items-start justify-between gap-3">
          <Skeleton className="h-6 w-20 rounded-sm" />
          <Skeleton className="h-3 w-20 rounded-sm" />
        </div>
        <div className="mb-6 flex-1 space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-7 w-40 rounded-sm" />
            <Skeleton className="h-4 w-full rounded-sm" />
            <Skeleton className="h-4 w-4/5 rounded-sm" />
          </div>
          <Skeleton className="h-4 w-28 rounded-sm" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-1.5 flex-1 rounded-full" />
            <Skeleton className="h-3 w-10 rounded-sm" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-6 w-24 rounded-sm" />
            <Skeleton className="h-6 w-24 rounded-sm" />
            <Skeleton className="h-6 w-24 rounded-sm" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-24 rounded-sm" />
            <Skeleton className="h-14 w-full rounded-sm" />
            <Skeleton className="h-14 w-full rounded-sm" />
          </div>
        </div>
        <div className="border-t border-[var(--border)] pt-4">
          <Skeleton className="h-10 w-44 rounded-sm" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function TasksProjectsLoadingPage() {
  return (
    <TasksWorkspaceShell
      eyebrow="Portfolio Overview"
      title="Projects"
      description="Command index for project status, task pressure, and direct entry into each project workspace."
      actions={<Skeleton className="h-8 w-32 rounded-sm" />}
    >
      <div className="mb-8 flex items-end gap-5 border-b border-[var(--border)] pb-6">
        <div className="text-right">
          <Skeleton className="mb-2 h-3 w-12 rounded-sm" />
          <Skeleton className="h-8 w-12 rounded-sm" />
        </div>
        <div className="h-12 w-px bg-[var(--border)]" />
        <div className="text-right">
          <Skeleton className="mb-2 h-3 w-14 rounded-sm" />
          <Skeleton className="h-8 w-12 rounded-sm" />
        </div>
        <div className="h-12 w-px bg-[var(--border)]" />
        <div className="text-right">
          <Skeleton className="mb-2 h-3 w-18 rounded-sm" />
          <Skeleton className="h-8 w-12 rounded-sm" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
        <ProjectCardSkeleton />
        <ProjectCardSkeleton />
        <ProjectCardSkeleton />
        <ProjectCardSkeleton />
      </div>
    </TasksWorkspaceShell>
  );
}
