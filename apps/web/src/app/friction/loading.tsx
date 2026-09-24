import { WorkspaceSkeletonShell } from "@/components/layout/workspace-skeleton-shell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function FrictionLoadingPage() {
  return (
    <WorkspaceSkeletonShell
      title="Friction"
      description="Where work stalls, and what to do about it."
    >
      <div className="flex flex-col gap-6">
        <div className="kpi-grid">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-20 w-full rounded-[var(--radius-lg)]" />
          ))}
        </div>
        <Card clip>
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center gap-3 border-b border-[var(--ega-divider)] px-3.5 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-56 max-w-full" />
                <Skeleton className="h-3 w-36 max-w-full" />
              </div>
              <Skeleton className="h-5 w-16 shrink-0" />
            </div>
          ))}
        </Card>
      </div>
    </WorkspaceSkeletonShell>
  );
}
