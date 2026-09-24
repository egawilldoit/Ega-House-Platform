import { WorkspaceSkeletonShell } from "@/components/layout/workspace-skeleton-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function IdeasLoadingPage() {
  return (
    <WorkspaceSkeletonShell
      title="Ideas"
      description="Capture thoughts now, sort them into work later."
    >
      <div className="flex flex-col gap-6">
        <Card>
          <CardContent className="flex flex-col gap-3">
            <Skeleton className="h-8 w-full max-w-2xl" />
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-28" />
            </div>
          </CardContent>
        </Card>

        <Card clip>
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ega-divider)] px-[18px] py-3">
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="ml-auto h-8 w-24" />
          </div>
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center gap-3 border-b border-[var(--ega-divider)] px-3.5 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-64 max-w-full" />
                <Skeleton className="h-3 w-40 max-w-full" />
              </div>
              <Skeleton className="h-7 w-20 shrink-0" />
            </div>
          ))}
        </Card>
      </div>
    </WorkspaceSkeletonShell>
  );
}
