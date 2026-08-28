import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getFrictionRadar } from "@/lib/services/friction-service";
import { AlertTriangle, PauseCircle, Clock3 } from "lucide-react";

export const dynamic = "force-dynamic";

function AgeBadge({ days }: { days: number }) {
  return <Badge tone={days >= 7 ? "warn" : "muted"}>{days}d ago</Badge>;
}

export default async function FrictionRadarPage() {
  const user = await getCurrentUser();
  if (!user) {
    return <div className="p-6">Please log in to view friction signals.</div>;
  }

  const now = new Date();
  const result = await getFrictionRadar({ now });

  if (result.errorMessage || !result.data) {
    return <div className="p-6">Failed to load friction signals: {result.errorMessage}</div>;
  }

  const { blocked, staleTasks, staleGoals, thresholdDays, generatedAt } = result.data;
  const hasAny = blocked.length > 0 || staleTasks.length > 0 || staleGoals.length > 0;

  return (
    <AppShell
      eyebrow="Friction Radar"
      title="Workflow Friction"
      description={`Deterministic stale (${thresholdDays}d) and blocked-work signals. Generated ${new Date(generatedAt).toLocaleString()}.`}
    >
      {!hasAny ? (
        <EmptyState
          icon={Clock3}
          title="No friction detected"
          description="No blocked or stale work found. Your active tasks and goals are fresh."
        />
      ) : null}

      {/* Blocked */}
      <section className="mt-6">
        <Card className="ega-glass rounded-[1.35rem]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PauseCircle className="h-5 w-5" aria-hidden="true" />
              Blocked ({blocked.length})
            </CardTitle>
            <CardDescription>Active tasks with status Blocked — includes blocker reason when present and age.</CardDescription>
          </CardHeader>
          <CardContent>
            {blocked.length === 0 ? (
              <p className="text-sm text-[color:var(--muted-foreground)]">No blocked tasks.</p>
            ) : (
              <ul className="space-y-3">
                {blocked.map((task) => (
                  <li
                    key={task.id}
                    className="ega-glass-soft flex flex-col gap-1 rounded-[1rem] px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium text-[color:var(--foreground)]">
                        {task.title}
                      </span>
                      <AgeBadge days={task.ageDays} />
                    </div>
                    <p className="text-xs text-[color:var(--muted-foreground)]">
                      {task.blockedReason ? `Reason: ${task.blockedReason}` : "No blocker reason provided"}
                    </p>
                    <p className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
                      Updated {new Date(task.updatedAt).toLocaleDateString()} · {task.status}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Stale Tasks */}
      <section className="mt-4">
        <Card className="ega-glass rounded-[1.35rem]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock3 className="h-5 w-5" aria-hidden="true" />
              Stale Tasks ({staleTasks.length})
            </CardTitle>
            <CardDescription>
              Active tasks with no update for ≥ {thresholdDays} days.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {staleTasks.length === 0 ? (
              <p className="text-sm text-[color:var(--muted-foreground)]">No stale tasks.</p>
            ) : (
              <ul className="space-y-3">
                {staleTasks.map((task) => (
                  <li
                    key={task.id}
                    className="ega-glass-soft flex flex-col gap-1 rounded-[1rem] px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium text-[color:var(--foreground)]">
                        {task.title}
                      </span>
                      <AgeBadge days={task.ageDays} />
                    </div>
                    <p className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
                      Status {task.status} · Updated {new Date(task.updatedAt).toLocaleDateString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Stale Goals */}
      <section className="mt-4">
        <Card className="ega-glass rounded-[1.35rem]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              Stale Goals ({staleGoals.length})
            </CardTitle>
            <CardDescription>Active goals with no update for ≥ {thresholdDays} days.</CardDescription>
          </CardHeader>
          <CardContent>
            {staleGoals.length === 0 ? (
              <p className="text-sm text-[color:var(--muted-foreground)]">No stale goals.</p>
            ) : (
              <ul className="space-y-3">
                {staleGoals.map((goal) => (
                  <li
                    key={goal.id}
                    className="ega-glass-soft flex flex-col gap-1 rounded-[1rem] px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium text-[color:var(--foreground)]">
                        {goal.title}
                      </span>
                      <AgeBadge days={goal.ageDays} />
                    </div>
                    <p className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
                      Status {goal.status} · Updated {new Date(goal.updatedAt).toLocaleDateString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
