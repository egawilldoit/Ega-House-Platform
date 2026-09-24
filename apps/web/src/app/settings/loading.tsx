import { WorkspaceSkeletonShell } from "@/components/layout/workspace-skeleton-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoadingPage() {
  return (
    <WorkspaceSkeletonShell
      title="Settings"
      description="Account and calendar controls."
    >
      <div className="flex max-w-3xl flex-col gap-6">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index}>
            <CardContent className="flex flex-col gap-3">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-4 w-full max-w-md" />
              <Skeleton className="h-8 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    </WorkspaceSkeletonShell>
  );
}
