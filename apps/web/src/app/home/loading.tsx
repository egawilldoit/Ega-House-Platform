import { WorkspaceSkeletonShell } from "@/components/layout/workspace-skeleton-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function PanelSkeleton({ rows }: { rows: number }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-4 w-32" />
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-4 w-full max-w-md" />
        ))}
      </CardContent>
    </Card>
  );
}

export default function HomeLoadingPage() {
  return (
    <WorkspaceSkeletonShell
      title="Home"
      description="What to do now, what needs attention, and what to start next."
    >
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-6 w-64" />
          <div className="kpi-grid">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-20 w-full rounded-[var(--radius-lg)]" />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <Skeleton className="h-6 w-56" />
          <div className="workspace-main-rail-grid">
            <div className="flex flex-col gap-4">
              <PanelSkeleton rows={3} />
              <PanelSkeleton rows={2} />
            </div>
            <div className="workspace-secondary-rail">
              <PanelSkeleton rows={4} />
              <PanelSkeleton rows={2} />
            </div>
          </div>
        </div>
      </div>
    </WorkspaceSkeletonShell>
  );
}
