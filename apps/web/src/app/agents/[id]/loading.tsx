import { WorkspaceSkeletonShell } from "@/components/layout/workspace-skeleton-shell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function AgentDetailLoadingPage() {
  return (
    <WorkspaceSkeletonShell title="Agent" description="Agent identity, capabilities and activity.">
      <div className="flex flex-col gap-4">
        <Card>
          <div className="flex items-start gap-3 px-5 py-5">
            <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-5 w-40 max-w-full" />
              <Skeleton className="h-3 w-72 max-w-full" />
            </div>
          </div>
        </Card>
        {Array.from({ length: 2 }).map((_, index) => (
          <Card key={index}>
            <div className="border-b border-[var(--ega-divider)] px-4 py-4">
              <Skeleton className="h-5 w-32" />
            </div>
            <div className="flex flex-col gap-2 px-4 py-4">
              <Skeleton className="h-4 w-64 max-w-full" />
              <Skeleton className="h-3 w-48 max-w-full" />
            </div>
          </Card>
        ))}
      </div>
    </WorkspaceSkeletonShell>
  );
}
