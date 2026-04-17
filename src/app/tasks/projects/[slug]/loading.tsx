import { TasksWorkspaceShell } from "@/components/tasks/tasks-workspace-shell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function ProjectTaskRowSkeleton() {
  return (
    <article className="rounded-sm border border-[var(--border)] bg-[color:var(--instrument-raised)] px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-56 max-w-full rounded-sm" />
          <Skeleton className="h-3 w-32 max-w-full rounded-sm" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-6 w-24 rounded-sm" />
          <Skeleton className="h-6 w-20 rounded-sm" />
        </div>
      </div>
      <div className="mt-3 space-y-2">
        <Skeleton className="h-4 w-full rounded-sm" />
        <Skeleton className="h-4 w-10/12 rounded-sm" />
      </div>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3 border-t border-[var(--border)] pt-4">
        <div className="space-y-2 pt-2">
          <Skeleton className="h-3 w-72 max-w-full rounded-sm" />
          <Skeleton className="h-3 w-32 max-w-full rounded-sm" />
        </div>
        <Skeleton className="h-10 w-44 rounded-sm" />
      </div>
    </article>
  );
}

export default function ProjectDetailLoadingPage() {
  return (
    <TasksWorkspaceShell
      eyebrow="Tasks Workspace"
      title="Project"
      description="Project-scoped task view with direct task creation in the same workspace."
      actions={<Skeleton className="h-8 w-32 rounded-sm" />}
      navigation={
        <>
          <Badge tone="accent">Project</Badge>
          <Badge>Tasks</Badge>
          <Badge>Goals</Badge>
        </>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card>
          <CardHeader className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-2">
                <CardTitle>
                  <Skeleton className="h-7 w-44" />
                </CardTitle>
                <CardDescription>
                  <Skeleton className="h-4 w-56 max-w-full" />
                </CardDescription>
              </div>
              <div className="space-y-3">
                <div className="flex flex-wrap justify-end gap-2">
                  <Skeleton className="h-6 w-28 rounded-sm" />
                  <Skeleton className="h-6 w-24 rounded-sm" />
                  <Skeleton className="h-6 w-24 rounded-sm" />
                </div>
                <Skeleton className="h-10 w-44 rounded-sm" />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-8 w-28 rounded-sm" />
              <Skeleton className="h-8 w-28 rounded-sm" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <ProjectTaskRowSkeleton />
            <ProjectTaskRowSkeleton />
            <ProjectTaskRowSkeleton />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <Skeleton className="h-7 w-28" />
            </CardTitle>
            <CardDescription>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-2/3" />
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-10 w-36 rounded-sm" />
          </CardContent>
        </Card>
      </div>
    </TasksWorkspaceShell>
  );
}
