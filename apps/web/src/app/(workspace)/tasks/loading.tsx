import { WorkspaceSkeletonShell } from "@/components/layout/workspace-skeleton-shell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function TaskRowSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-[var(--ega-divider)] px-3.5 py-3 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-56 max-w-full" />
        <Skeleton className="h-3 w-36 max-w-full" />
      </div>
      <Skeleton className="hidden h-5 w-20 sm:block" />
      <Skeleton className="hidden h-5 w-16 md:block" />
      <Skeleton className="h-7 w-24 shrink-0" />
    </div>
  );
}

export default function TasksLoadingPage() {
  return (
    <WorkspaceSkeletonShell
      title="Tasks"
      description="Find, organize, and move your work forward."
      actions={<Skeleton className="h-8 w-24" />}
    >
      {/* Mirrors the rail-free composition: one full-width inventory card with a
          two-row toolbar. */}
      <Card clip>
        <div className="flex flex-col gap-3 border-b border-[var(--ega-divider)] px-[18px] py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="ml-auto h-8 w-24" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="ml-auto h-4 w-40" />
          </div>
        </div>
        <div>
          <TaskRowSkeleton />
          <TaskRowSkeleton />
          <TaskRowSkeleton />
          <TaskRowSkeleton />
          <TaskRowSkeleton />
        </div>
      </Card>
    </WorkspaceSkeletonShell>
  );
}
