import { WorkspaceContentSkeleton } from "@/components/layout/workspace-content-skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function HomeGreetingSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-10 w-80 max-w-full" />
      <Skeleton className="h-5 w-56" />
    </div>
  );
}

function NowPanelSkeleton() {
  return (
    <Card level="hero">
      <CardContent className="flex flex-col gap-4">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-7 w-72 max-w-full" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-12 w-56" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-28" />
        </div>
      </CardContent>
    </Card>
  );
}

function QuickActionsSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-2" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, index) => (
        <Skeleton key={index} className="h-11 w-44" />
      ))}
    </div>
  );
}

function StatsRowSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-hidden="true">
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={index}
          className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--ega-border)] bg-[color:var(--ega-surface)] px-[18px] py-4"
        >
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-7 w-12" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

function SecondaryPanelSkeleton({ rows }: { rows: number }) {
  return (
    <Card level="compact">
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-4 w-24" />
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-4 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

function ActivityPulseSkeleton() {
  return (
    <Card level="compact">
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-20 w-full" />
      </CardContent>
    </Card>
  );
}

/**
 * Skeleton mirror of the approved Home redesign anatomy: greeting/date, the
 * dominant Now panel, quick actions directly beneath, the compact
 * Today / Next / Attention row, then the wide Activity pulse.
 */
export default function HomeLoadingPage() {
  return (
    <WorkspaceContentSkeleton>
      <div className="flex flex-col gap-8">
        <HomeGreetingSkeleton />
        <StatsRowSkeleton />
        <NowPanelSkeleton />
        <QuickActionsSkeleton />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <SecondaryPanelSkeleton rows={3} />
          <SecondaryPanelSkeleton rows={2} />
          <SecondaryPanelSkeleton rows={3} />
        </div>
        <ActivityPulseSkeleton />
      </div>
    </WorkspaceContentSkeleton>
  );
}
