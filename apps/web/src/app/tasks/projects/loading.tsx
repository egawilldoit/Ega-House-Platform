import { TasksWorkspaceShell } from "@/components/tasks/tasks-workspace-shell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function ProjectRowSkeleton() {
  return (
    <div className="row">
      <div className="row-main">
        <Skeleton className="h-4 w-48 max-w-full" />
        <Skeleton className="h-3 w-24 max-w-full" />
      </div>
      <Skeleton className="h-5 w-20" />
      <Skeleton className="hidden h-5 w-24 md:block" />
      <Skeleton className="hidden h-5 w-32 sm:block" />
    </div>
  );
}

export default function TasksProjectsLoadingPage() {
  return (
    <TasksWorkspaceShell
      title="Projects"
      description="Project directory — status, active work, progress, and recency."
      actions={<Skeleton className="h-8 w-28" />}
    >
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

        <Card flush label="Directory" title="Project directory">
          <div className="rows">
            <ProjectRowSkeleton />
            <ProjectRowSkeleton />
            <ProjectRowSkeleton />
            <ProjectRowSkeleton />
          </div>
        </Card>
      </div>
    </TasksWorkspaceShell>
  );
}
