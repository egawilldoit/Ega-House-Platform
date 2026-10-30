import { WorkspaceSkeletonShell } from "@/components/layout/workspace-skeleton-shell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function FavouriteRowSkeleton() {
  return (
    <div className="row">
      <div className="row-main">
        <Skeleton className="h-4 w-48 max-w-full" />
        <Skeleton className="h-3 w-32 max-w-full" />
      </div>
      <Skeleton className="h-6 w-20" />
    </div>
  );
}

export default function FavoritesLoadingPage() {
  return (
    <WorkspaceSkeletonShell
      title="Favourites"
      description="Starred projects and tasks for quick navigation."
    >
      <div className="flex flex-col gap-4">
        <Card label="Favourites" title="Projects">
          <div className="rows">
            <FavouriteRowSkeleton />
            <FavouriteRowSkeleton />
          </div>
        </Card>
        <Card label="Favourites" title="Tasks">
          <div className="rows">
            <FavouriteRowSkeleton />
            <FavouriteRowSkeleton />
            <FavouriteRowSkeleton />
          </div>
        </Card>
      </div>
    </WorkspaceSkeletonShell>
  );
}
