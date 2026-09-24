import { WorkspaceSkeletonShell } from "@/components/layout/workspace-skeleton-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function GoalRowSkeleton() {
  return (
    <div className="row">
      <div className="row-main">
        <Skeleton className="h-4 w-48 max-w-full" />
        <Skeleton className="h-3 w-32 max-w-full" />
      </div>
      <Skeleton className="h-5 w-20" />
      <Skeleton className="h-5 w-20" />
    </div>
  );
}

export default function GoalsLoadingPage() {
  return (
    <WorkspaceSkeletonShell
      title="Goals"
      description="Objectives with health, progress, next step, and linked tasks."
    >
      <div className="flex flex-col gap-6">
        <div className="kpi-grid">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="kpi-card">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-3 w-32 max-w-full" />
            </div>
          ))}
        </div>

        <div className="workspace-split-grid">
          <Card label="Directory" title="Goals">
            <div className="rows">
              <GoalRowSkeleton />
              <GoalRowSkeleton />
              <GoalRowSkeleton />
            </div>
          </Card>

          <Card label="Goal detail" title="Selected goal">
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-end justify-between gap-4">
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-4 w-28" />
              </div>
              <Skeleton className="h-1.5 w-full" />
              <div className="grid gap-3 sm:grid-cols-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-24" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-10/12" />
              <Skeleton className="h-32 w-full" />
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-8 w-32" />
                <Skeleton className="h-8 w-32" />
                <Skeleton className="h-8 w-32" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </WorkspaceSkeletonShell>
  );
}
