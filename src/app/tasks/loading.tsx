import { TasksWorkspaceShell } from "@/components/tasks/tasks-workspace-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function TaskRowSkeleton() {
  return (
    <article className="rounded-sm border border-[var(--border)] bg-[color:var(--instrument-raised)] px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 space-y-3">
          <div className="flex items-start gap-3">
            <Skeleton className="mt-2 h-2 w-2 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-56 max-w-full rounded-sm" />
              <Skeleton className="h-3 w-40 max-w-full rounded-sm" />
            </div>
          </div>
          <Skeleton className="h-4 w-full rounded-sm" />
          <Skeleton className="h-4 w-11/12 rounded-sm" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-6 w-24 rounded-sm" />
          <Skeleton className="h-6 w-20 rounded-sm" />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3 border-t border-[var(--border)] pt-4">
        <div className="flex-1 space-y-2 pt-2">
          <Skeleton className="h-3 w-20 max-w-full rounded-sm" />
          <Skeleton className="h-4 w-24 max-w-full rounded-sm" />
        </div>
        <Skeleton className="h-10 w-80 max-w-full rounded-sm" />
      </div>
    </article>
  );
}

export default function TasksLoadingPage() {
  return (
    <TasksWorkspaceShell
      eyebrow="Execution Workspace"
      title="Tasks"
      description="Active execution queue with inline state control and task initialization."
      actions={<Skeleton className="h-8 w-24 rounded-sm" />}
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="border-[var(--border)] bg-[color:var(--instrument)]">
          <CardContent className="p-6">
            <div className="mb-5 flex items-end justify-between gap-4">
              <div className="space-y-2">
                <Skeleton className="h-3 w-36 rounded-sm" />
                <Skeleton className="h-4 w-48 rounded-sm" />
              </div>
            </div>

            <div className="mb-6 space-y-4">
              <div className="space-y-2">
                <Skeleton className="h-3 w-14 rounded-sm" />
                <div className="flex flex-wrap gap-2">
                  <Skeleton className="h-8 w-20 rounded-sm" />
                  <Skeleton className="h-8 w-28 rounded-sm" />
                  <Skeleton className="h-8 w-24 rounded-sm" />
                </div>
              </div>
              <div className="space-y-2">
                <Skeleton className="h-3 w-16 rounded-sm" />
                <div className="flex flex-wrap gap-2">
                  <Skeleton className="h-8 w-24 rounded-sm" />
                  <Skeleton className="h-8 w-32 rounded-sm" />
                </div>
              </div>
            </div>

            <div className="space-y-3">
            <TaskRowSkeleton />
            <TaskRowSkeleton />
            <TaskRowSkeleton />
            </div>
          </CardContent>
        </Card>

        <Card className="border-[var(--border)] bg-[color:var(--instrument)]">
          <CardContent className="p-6">
            <div className="mb-5 space-y-2">
              <Skeleton className="h-3 w-28 rounded-sm" />
              <Skeleton className="h-4 w-48 rounded-sm" />
            </div>
            <div className="space-y-4">
              <Skeleton className="h-3 w-12 rounded-sm" />
              <Skeleton className="h-10 w-full rounded-sm" />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Skeleton className="h-3 w-16 rounded-sm" />
                  <Skeleton className="h-10 w-full rounded-sm" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-3 w-16 rounded-sm" />
                  <Skeleton className="h-10 w-full rounded-sm" />
                </div>
              </div>
              <div className="space-y-2">
                <Skeleton className="h-3 w-24 rounded-sm" />
                <Skeleton className="h-28 w-full rounded-sm" />
              </div>
              <Skeleton className="h-10 w-40 rounded-sm" />
            </div>
          </CardContent>
        </Card>
      </div>
    </TasksWorkspaceShell>
  );
}
