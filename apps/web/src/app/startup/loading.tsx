import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function StartupLoadingPage() {
  return (
    <AppShell
      title="Startup"
      description="Start the day deliberately: attention, priorities, and one focus."
    >
      <div className="flex flex-col gap-6">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index}>
            <CardContent className="flex flex-col gap-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-full max-w-xl" />
              <Skeleton className="h-8 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
