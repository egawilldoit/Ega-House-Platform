import { WorkspaceSkeletonShell } from "@/components/layout/workspace-skeleton-shell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function AgentsLoadingPage() {
  return (
    <WorkspaceSkeletonShell
      title="Agents"
      description="Owner-registered agent identities, their credentials and observed activity."
    >
      <div className="flex flex-col gap-4">
        <Card clip>
          <div className="border-b border-[var(--ega-divider)] px-4 py-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-2 h-3 w-80 max-w-full" />
          </div>
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="flex items-start gap-3 border-b border-[var(--ega-divider)] px-4 py-4 last:border-b-0"
            >
              <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-40 max-w-full" />
                <Skeleton className="h-3 w-64 max-w-full" />
              </div>
            </div>
          ))}
        </Card>
        <Skeleton className="h-12 w-full" />
      </div>
    </WorkspaceSkeletonShell>
  );
}
