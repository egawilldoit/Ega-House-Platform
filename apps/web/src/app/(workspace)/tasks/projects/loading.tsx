import { WorkspaceContentSkeleton } from "@/components/layout/workspace-content-skeleton";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function ProjectRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-6 py-4">
      <Skeleton className="h-9 w-9 rounded-full" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-32" />
      </div>
      <Skeleton className="h-4 w-16" />
    </div>
  );
}

export default function TasksProjectsLoadingPage() {
  return (
    <WorkspaceContentSkeleton>
      <div className="flex flex-col gap-6">
        <div className="kpi-grid">
          {[0, 1, 2].map((index) => (
            <div key={index} className="kpi-card">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-12" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>

        <Card clip label="Directory" title="Project directory">
          <div className="rows">
            <ProjectRowSkeleton />
            <ProjectRowSkeleton />
            <ProjectRowSkeleton />
            <ProjectRowSkeleton />
          </div>
        </Card>
      </div>
    </WorkspaceContentSkeleton>
  );
}
