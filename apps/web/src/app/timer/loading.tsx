import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function TimerLoadingPage() {
  return (
    <AppShell
      title="Timer"
      description="The active session is primary: elapsed time, stop, and the canonical session history."
    >
      <div className="flex flex-col gap-6">
        <Card>
          <CardContent className="flex flex-col gap-4">
            <Skeleton className="h-5 w-36" />
            <div className="workspace-split-grid">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-6 w-64" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-52" />
              </div>
              <Skeleton className="h-24 w-52" />
            </div>
          </CardContent>
        </Card>

        <div className="kpi-grid">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full rounded-[var(--radius-lg)]" />
          ))}
        </div>

        <Card>
          <CardContent className="flex flex-col gap-3">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
