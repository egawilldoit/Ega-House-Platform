import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function RailCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-28 rounded-sm" />
        <Skeleton className="mt-1 h-3 w-40 rounded-sm" />
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-4 w-full rounded-sm" />
        <Skeleton className="h-4 w-4/5 rounded-sm" />
        <Skeleton className="h-8 w-32 rounded-sm" />
      </CardContent>
    </Card>
  );
}

export default function ReviewLoadingPage() {
  return (
    <AppShell
      title="Review"
      description="What happened this week, and what to change next."
    >
      <div className="flex flex-col gap-6">
        <Card>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <Skeleton className="h-8 w-56 rounded-sm" />
              <Skeleton className="h-8 w-24 rounded-sm" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Skeleton className="h-4 w-52 rounded-sm" />
              <div className="flex gap-2">
                <Skeleton className="h-8 w-20 rounded-sm" />
                <Skeleton className="h-8 w-20 rounded-sm" />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Skeleton className="h-5 w-40 rounded-sm" />
          <div className="kpi-grid">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-ega-border bg-ega-surface px-[18px] py-4"
              >
                <Skeleton className="h-3 w-20 rounded-sm" />
                <Skeleton className="h-6 w-24 rounded-sm" />
                <Skeleton className="h-3 w-28 rounded-sm" />
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <RailCardSkeleton />
          <RailCardSkeleton />
        </div>

        <div className="workspace-main-rail-grid">
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <Skeleton className="h-4 w-32 rounded-sm" />
                <Skeleton className="mt-1 h-3 w-64 rounded-sm" />
              </CardHeader>
              <CardContent className="space-y-4">
                <Skeleton className="h-10 w-full rounded-sm" />
                <Skeleton className="h-36 w-full rounded-sm" />
                <div className="grid gap-4 md:grid-cols-2">
                  <Skeleton className="h-32 w-full rounded-sm" />
                  <Skeleton className="h-32 w-full rounded-sm" />
                </div>
                <Skeleton className="h-32 w-full rounded-sm" />
                <Skeleton className="h-8 w-32 rounded-sm" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Skeleton className="h-4 w-36 rounded-sm" />
                <Skeleton className="mt-1 h-3 w-56 rounded-sm" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-24 w-full rounded-sm" />
              </CardContent>
            </Card>
          </div>

          <div className="workspace-secondary-rail">
            <RailCardSkeleton />
            <RailCardSkeleton />
            <RailCardSkeleton />
          </div>
        </div>

        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-32 rounded-sm" />
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full rounded-sm" />
            ))}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
