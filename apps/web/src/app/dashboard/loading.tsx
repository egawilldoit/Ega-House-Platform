import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoadingPage() {
  return (
    <AppShell
      eyebrow="Operational Command"
      title="Dashboard"
      description="A live snapshot of task pressure, goal movement, project health, timer activity, and review momentum."
    >
      <div className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-44 w-full rounded-xl" />
          <Skeleton className="h-44 w-full rounded-xl" />
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card className="border-[var(--border)] bg-white">
            <CardContent className="space-y-3 p-5">
              <Skeleton className="h-5 w-40 rounded-sm" />
              <Skeleton className="h-20 w-full rounded-sm" />
              <Skeleton className="h-20 w-full rounded-sm" />
              <Skeleton className="h-20 w-full rounded-sm" />
            </CardContent>
          </Card>

          <Card className="border-[var(--border)] bg-white">
            <CardContent className="space-y-3 p-5">
              <Skeleton className="h-5 w-40 rounded-sm" />
              <Skeleton className="h-24 w-full rounded-sm" />
              <Skeleton className="h-24 w-full rounded-sm" />
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

