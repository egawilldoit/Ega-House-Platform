import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function PanelSkeleton({ bodyHeight = "h-48" }: { bodyHeight?: string }) {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-32 rounded-sm" />
        <Skeleton className="mt-1 h-3 w-48 rounded-sm" />
      </CardHeader>
      <CardContent>
        <Skeleton className={`w-full rounded-sm ${bodyHeight}`} />
      </CardContent>
    </Card>
  );
}

export default function WorkAnalyticsLoadingPage() {
  return (
    <AppShell
      title="Analytics"
      description="Focused time answers — explicit, not decorative."
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-5 w-44 rounded-sm" />
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

        <PanelSkeleton bodyHeight="h-64" />

        <div className="flex flex-col gap-4">
          <Skeleton className="h-5 w-56 rounded-sm" />
          <div className="grid gap-4 lg:grid-cols-3">
            <PanelSkeleton bodyHeight="h-40" />
            <PanelSkeleton bodyHeight="h-40" />
            <PanelSkeleton bodyHeight="h-40" />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <PanelSkeleton bodyHeight="h-32" />
          <PanelSkeleton bodyHeight="h-32" />
          <PanelSkeleton bodyHeight="h-32" />
        </div>

        <div className="flex flex-col gap-4">
          <Skeleton className="h-5 w-52 rounded-sm" />
          <Card flush>
            <CardContent className="space-y-3">
              <Skeleton className="h-8 w-full rounded-sm" />
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-11 w-full rounded-sm" />
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
