import { WorkspaceSkeletonShell } from "@/components/layout/workspace-skeleton-shell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function ArchiveRowSkeleton() {
  return (
    <div className="row">
      <div className="row-main">
        <Skeleton className="h-4 w-48 max-w-full" />
        <Skeleton className="h-3 w-32 max-w-full" />
      </div>
      <Skeleton className="h-5 w-20" />
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-8 w-20" />
    </div>
  );
}

export default function ArchiveLoadingPage() {
  return (
    <WorkspaceSkeletonShell
      title="Archive"
      description="Restore archived tasks, goals and projects. Archived work keeps its history."
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-7 w-28" />
        </div>

        <Card>
          <div className="panel-body flex flex-wrap items-end gap-3">
            <Skeleton className="h-9 w-full max-w-md" />
          </div>
        </Card>

        <Card>
          <div className="rows">
            <ArchiveRowSkeleton />
            <ArchiveRowSkeleton />
            <ArchiveRowSkeleton />
          </div>
        </Card>
      </div>
    </WorkspaceSkeletonShell>
  );
}
