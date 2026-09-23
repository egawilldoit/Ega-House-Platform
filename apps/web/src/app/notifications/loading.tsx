import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function NotificationsLoadingPage() {
  return (
    <AppShell
      title="Notifications"
      description="Reminders and updates across your workspace."
    >
      <Card clip>
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ega-divider)] px-[18px] py-3">
          <Skeleton className="h-8 w-14" />
          <Skeleton className="h-8 w-20" />
        </div>
        {Array.from({ length: 7 }).map((_, index) => (
          <div
            key={index}
            className="flex items-start gap-3 border-b border-[var(--ega-divider)] px-3.5 py-3 last:border-b-0"
          >
            <Skeleton className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-72 max-w-full" />
              <Skeleton className="h-3 w-52 max-w-full" />
            </div>
            <Skeleton className="h-7 w-20 shrink-0" />
          </div>
        ))}
      </Card>
    </AppShell>
  );
}
