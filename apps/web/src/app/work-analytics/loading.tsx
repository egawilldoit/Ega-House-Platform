import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function WorkAnalyticsLoadingPage() {
  return (
    <AppShell
      eyebrow="Execution"
      title="Work Analytics"
      description="Worked time/session signals for today, week, and recent trend."
    >
      {/* Filter pills skeleton */}
      <div className="mb-6">
        <div className="flex flex-wrap items-start gap-4">
          {["Range", "Group by", "Breakdown", "Include open sessions"].map(
            (label) => (
              <fieldset key={label}>
                <legend className="mb-1 text-xs font-medium text-[color:var(--muted-foreground)]">
                  {label}
                </legend>
                <div className="flex flex-wrap gap-1">
                  <Skeleton className="h-7 w-16 rounded-full" />
                  <Skeleton className="h-7 w-20 rounded-full" />
                </div>
              </fieldset>
            ),
          )}
        </div>
      </div>

      {/* Core summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                <Skeleton className="h-4 w-16 rounded-sm" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-20 rounded-sm" />
              <Skeleton className="mt-1 h-3 w-24 rounded-sm" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Secondary info row */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                <Skeleton className="h-4 w-20 rounded-sm" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16 rounded-sm" />
              <Skeleton className="mt-1 h-3 w-28 rounded-sm" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Month comparison row */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                <Skeleton className="h-4 w-24 rounded-sm" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16 rounded-sm" />
              <Skeleton className="mt-1 h-3 w-28 rounded-sm" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Estimate accuracy + Interactive section */}
      <div className="mt-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              <Skeleton className="h-4 w-28 rounded-sm" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i}>
                  <Skeleton className="h-3 w-16 rounded-sm" />
                  <Skeleton className="mt-1 h-6 w-12 rounded-sm" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Trend charts / breakdown skeleton */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              <Skeleton className="h-4 w-24 rounded-sm" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Skeleton className="h-48 w-full rounded-sm" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              <Skeleton className="h-4 w-28 rounded-sm" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded-sm" />
            ))}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
