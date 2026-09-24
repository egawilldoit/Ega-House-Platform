import { WorkspaceSkeletonShell } from "@/components/layout/workspace-skeleton-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-5 w-32" />
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

export default function TodayLoadingPage() {
  return (
    <WorkspaceSkeletonShell
      title="Today"
      description="Focus on what matters today. Make progress, one step at a time."
      actions={<Skeleton className="h-8 w-48" />}
    >
      <div className="flex flex-col gap-6">
        <div className="kpi-grid">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full rounded-[var(--radius-lg)]" />
          ))}
        </div>

        <div className="workspace-main-rail-grid">
          <div className="flex flex-col gap-4">
            <PanelSkeleton rows={2} />
            <PanelSkeleton rows={5} />
          </div>
          <div className="workspace-secondary-rail">
            <PanelSkeleton rows={3} />
            <PanelSkeleton rows={4} />
          </div>
        </div>
      </div>
    </WorkspaceSkeletonShell>
  );
}
