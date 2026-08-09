import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function TimerSummaryRowSkeleton() {
  return (
    <div className="rounded-sm border border-[var(--border)] bg-[color:var(--instrument-raised)] px-4 py-3">
      <Skeleton className="h-4 w-40 max-w-full rounded-sm" />
      <Skeleton className="mt-2 h-3 w-24 rounded-sm" />
    </div>
  );
}

export default function TimerLoadingPage() {
  return (
    <AppShell
      eyebrow="Team Performance"
      title="Time Tracking"
      description="Tracked time, project allocation, and recent session activity."
    >
      <div className="grid gap-6 md:grid-cols-3">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        <Card className="border-[var(--border)] bg-white">
          <CardContent className="p-8">
            <Skeleton className="h-3 w-28 rounded-sm" />
            <div className="mt-8 flex justify-center">
              <Skeleton className="h-48 w-48 rounded-full" />
            </div>
            <div className="mt-8 space-y-3">
              <Skeleton className="h-4 w-full rounded-sm" />
              <Skeleton className="h-4 w-full rounded-sm" />
              <Skeleton className="h-4 w-full rounded-sm" />
            </div>
            <div className="mt-8 border-t border-[var(--border)] pt-6 space-y-3">
              <Skeleton className="h-3 w-28 rounded-sm" />
              <Skeleton className="h-10 w-full rounded-sm" />
              <Skeleton className="h-10 w-32 rounded-sm" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-[var(--border)] bg-white lg:col-span-2">
          <CardContent className="p-6">
            <div className="mb-6 flex items-center justify-between">
              <Skeleton className="h-6 w-36 rounded-sm" />
              <Skeleton className="h-4 w-16 rounded-sm" />
            </div>
            <div className="space-y-8">
              <div>
                <Skeleton className="mb-3 h-3 w-20 rounded-sm" />
                <div className="space-y-2">
                  <TimerSummaryRowSkeleton />
                  <TimerSummaryRowSkeleton />
                </div>
              </div>
              <div>
                <Skeleton className="mb-3 h-3 w-24 rounded-sm" />
                <div className="space-y-2">
                  <TimerSummaryRowSkeleton />
                  <TimerSummaryRowSkeleton />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
