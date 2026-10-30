import { WorkspaceContentSkeleton } from "@/components/layout/workspace-content-skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function OverviewCardSkeleton() {
  return (
    <Card label="Section" title="Loading">
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-4 w-9/12" />
        <Skeleton className="h-4 w-7/12" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-16 w-full" />
      </CardContent>
    </Card>
  );
}

export default function ProjectDetailLoadingPage() {
  return (
    <WorkspaceContentSkeleton>
}
    >
      <div className="flex flex-col gap-6">
        <Skeleton className="h-10 w-72 max-w-full" />
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <OverviewCardSkeleton key={index} />
          ))}
        </div>
      </div>
</WorkspaceContentSkeleton>
  );
}
