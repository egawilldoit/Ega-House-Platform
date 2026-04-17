import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function GoalRowSkeleton() {
  return (
    <article className="rounded-sm border border-[var(--border)] bg-[color:var(--instrument-raised)] px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-5 w-48 max-w-full rounded-sm" />
          <Skeleton className="h-3 w-36 max-w-full rounded-sm" />
        </div>
        <Skeleton className="h-8 w-24 rounded-sm" />
      </div>
      <div className="mt-3 space-y-2">
        <Skeleton className="h-4 w-full rounded-sm" />
        <Skeleton className="h-4 w-10/12 rounded-sm" />
      </div>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3 border-t border-[var(--border)] pt-4">
        <Skeleton className="h-3 w-24 rounded-sm pt-2" />
        <Skeleton className="h-10 w-44 rounded-sm" />
      </div>
    </article>
  );
}

export default function GoalsLoadingPage() {
  return (
    <AppShell
      eyebrow="Strategic Tracking"
      title="Goals"
      description="Track strategic goals attached to projects."
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="border-[var(--border)] bg-white">
          <CardContent className="p-6">
            <div className="mb-5 space-y-2">
              <Skeleton className="h-3 w-32 rounded-sm" />
              <Skeleton className="h-8 w-36 rounded-sm" />
              <Skeleton className="h-4 w-64 rounded-sm" />
            </div>
            <div className="mb-6 rounded-sm border border-[var(--border)] bg-[color:var(--instrument-raised)] p-5">
              <Skeleton className="h-3 w-28 rounded-sm" />
              <Skeleton className="mt-3 h-8 w-24 rounded-sm" />
              <Skeleton className="mt-4 h-3 w-full rounded-full" />
            </div>
            <div className="space-y-3">
            <GoalRowSkeleton />
            <GoalRowSkeleton />
            <GoalRowSkeleton />
            </div>
          </CardContent>
        </Card>

        <Card className="border-[var(--border)] bg-white">
          <CardContent className="p-6">
            <div className="mb-5 space-y-2">
              <Skeleton className="h-6 w-28 rounded-sm" />
              <Skeleton className="h-4 w-2/3 rounded-sm" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-10 w-full rounded-sm" />
              <Skeleton className="h-10 w-full rounded-sm" />
              <div className="grid gap-3 sm:grid-cols-2">
                <Skeleton className="h-10 w-full rounded-sm" />
                <Skeleton className="h-10 w-full rounded-sm" />
              </div>
              <Skeleton className="h-28 w-full rounded-sm" />
              <Skeleton className="h-10 w-32 rounded-sm" />
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
