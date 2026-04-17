import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function ReviewEntrySkeleton() {
  return (
    <article className="rounded-sm border border-[var(--border)] bg-[color:var(--instrument-raised)] px-4 py-3">
      <Skeleton className="h-3 w-36 rounded-sm" />
      <div className="mt-2 space-y-2">
        <Skeleton className="h-4 w-full rounded-sm" />
        <Skeleton className="h-4 w-11/12 rounded-sm" />
        <Skeleton className="h-4 w-8/12 rounded-sm" />
      </div>
    </article>
  );
}

export default function ReviewLoadingPage() {
  return (
    <AppShell
      eyebrow="Cycle Summary"
      title="Weekly Review"
      description="Weekly summary, highlights, blockers, and saved reflection snapshots."
    >
      <div className="mb-8">
        <div className="space-y-4">
          <Skeleton className="h-10 w-64 rounded-sm" />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Skeleton className="h-4 w-56 rounded-sm" />
            <div className="flex gap-2">
              <Skeleton className="h-8 w-20 rounded-sm" />
              <Skeleton className="h-8 w-20 rounded-sm" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
        <div className="md:col-span-8">
          <Card className="h-full border-[var(--border)] bg-white">
            <CardContent className="p-8">
              <Skeleton className="h-3 w-28 rounded-sm" />
              <Skeleton className="mt-4 h-16 w-40 rounded-sm" />
              <Skeleton className="mt-4 h-4 w-3/4 rounded-sm" />
              <div className="mt-8 flex gap-3">
                <Skeleton className="h-10 w-36 rounded-sm" />
                <Skeleton className="h-10 w-32 rounded-sm" />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="md:col-span-4 flex flex-col gap-6">
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-36 w-full rounded-xl" />
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="space-y-6">
          <div className="space-y-4">
            <Skeleton className="h-6 w-40 rounded-sm" />
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>

          <div className="space-y-4">
            <Skeleton className="h-6 w-36 rounded-sm" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </div>

          <Card className="border-[var(--border)] bg-white">
            <CardContent className="p-6 space-y-3">
              <Skeleton className="h-6 w-36 rounded-sm" />
              <Skeleton className="h-4 w-4/5 rounded-sm" />
              <Skeleton className="h-10 w-full rounded-sm" />
              <Skeleton className="h-44 w-full rounded-sm" />
              <Skeleton className="h-10 w-32 rounded-sm" />
            </CardContent>
          </Card>
        </div>

        <Card className="border-[var(--border)] bg-white">
          <CardContent className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <Skeleton className="h-6 w-36 rounded-sm" />
              <Skeleton className="h-4 w-16 rounded-sm" />
            </div>
            <div className="space-y-3">
              <ReviewEntrySkeleton />
              <ReviewEntrySkeleton />
              <ReviewEntrySkeleton />
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
