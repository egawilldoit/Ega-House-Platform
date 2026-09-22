import { TasksWorkspaceShell } from "@/components/tasks/tasks-workspace-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function ProjectTaskRowSkeleton() {
  return (
    <div className="row">
      <div className="row-main">
        <Skeleton className="h-4 w-56 max-w-full" />
        <Skeleton className="h-3 w-40 max-w-full" />
      </div>
      <Skeleton className="h-5 w-20" />
      <Skeleton className="h-5 w-16" />
    </div>
  );
}

export default function ProjectDetailLoadingPage() {
  return (
    <TasksWorkspaceShell
      title="Project"
      description="Project workspace for goals, tasks, and execution controls."
      actions={<Skeleton className="h-8 w-32" />}
    >
      <div className="flex flex-col gap-6">
        <Card label="Overview" title="Project overview">
          <CardContent className="flex flex-col gap-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-8/12" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="flex flex-col gap-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-7 w-12" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>
            <Skeleton className="h-28 w-full" />
          </CardContent>
        </Card>

        <div className="workspace-split-grid">
          <Card label="Execution" title="Project tasks">
            <CardContent className="flex flex-col gap-4">
              <Skeleton className="h-10 w-full" />
              <div className="rows">
                <ProjectTaskRowSkeleton />
                <ProjectTaskRowSkeleton />
                <ProjectTaskRowSkeleton />
              </div>
            </CardContent>
          </Card>

          <div className="workspace-secondary-rail">
            <Card label="Strategy" title="Project goals">
              <div className="rows">
                <ProjectTaskRowSkeleton />
                <ProjectTaskRowSkeleton />
              </div>
            </Card>
            <Card label="Focus" title="Focus queue">
              <div className="rows">
                <ProjectTaskRowSkeleton />
              </div>
            </Card>
            <Card label="Time" title="Time tracking">
              <CardContent>
                <Skeleton className="h-8 w-32" />
              </CardContent>
            </Card>
            <Card label="Create" title="New project task">
              <CardContent>
                <Skeleton className="h-32 w-full" />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </TasksWorkspaceShell>
  );
}
