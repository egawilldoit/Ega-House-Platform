import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function SectionSkeleton() {
  return (
    <Card className="border-[var(--border)] bg-white">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-5 w-28 rounded-sm" />
          <Skeleton className="h-6 w-10 rounded-sm" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-1">
        <Skeleton className="h-28 w-full rounded-sm" />
      </CardContent>
    </Card>
  );
}

export default function TodayLoadingPage() {
  return (
    <AppShell
      eyebrow="Execution Workspace"
      title="Today"
      description="Build an intentional plan, then move directly into execution."
      actions={<Skeleton className="h-8 w-36 rounded-sm" />}
    >
      <div className="space-y-6">
        <Card className="border-[var(--border)] bg-white">
          <CardContent className="grid gap-3 px-5 pb-5 pt-5 sm:grid-cols-2 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-20 w-full rounded-sm" />
            ))}
          </CardContent>
        </Card>

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.24fr)_minmax(22rem,0.76fr)]">
          <div className="space-y-4">
            <SectionSkeleton />
            <SectionSkeleton />
            <SectionSkeleton />
            <SectionSkeleton />
          </div>

          <Card className="border-[var(--border)] bg-white">
            <CardHeader className="pb-4">
              <Skeleton className="h-5 w-28 rounded-sm" />
            </CardHeader>
            <CardContent className="space-y-3 pt-1">
              <Skeleton className="h-24 w-full rounded-sm" />
              <Skeleton className="h-24 w-full rounded-sm" />
              <Skeleton className="h-24 w-full rounded-sm" />
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
