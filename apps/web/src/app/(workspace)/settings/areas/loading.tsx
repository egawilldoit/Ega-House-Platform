import { WorkspaceSkeletonShell } from "@/components/layout/workspace-skeleton-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function AreasLoadingPage() {
  return (
    <WorkspaceSkeletonShell
      title="Settings"
      description="Group projects into life and work areas."
    >
      <div className="flex max-w-4xl flex-col gap-6" aria-busy="true" aria-live="polite">
        <Card>
          <CardContent className="flex flex-col gap-3">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-8 w-full max-w-sm" />
            <Skeleton className="h-8 w-24" />
          </CardContent>
        </Card>
        {Array.from({ length: 2 }).map((_, index) => (
          <Card key={index}>
            <CardContent className="flex flex-col gap-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-full max-w-md" />
              <Skeleton className="h-8 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    </WorkspaceSkeletonShell>
  );
}
