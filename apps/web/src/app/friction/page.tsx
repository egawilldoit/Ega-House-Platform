import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getFrictionRadar } from "@/lib/services/friction-service";
import { AlertTriangle, PauseCircle, Clock3, Timer, Shuffle, Flag, BarChart3 } from "lucide-react";

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

  const { blocked, staleTasks, staleGoals, thresholdDays, generatedAt, estimateSignals, contextSwitch, neglectedGoals, workloadImbalance, evidenceWindow } = result.data;
  const hasAny = blocked.length > 0 || staleTasks.length > 0 || staleGoals.length > 0 || estimateSignals.length > 0 || contextSwitch.isFriction || neglectedGoals.length > 0 || workloadImbalance.isImbalance;

  return (
    <AppShell
      eyebrow="Friction Radar"
      title="Workflow Friction"
      description={`Deterministic stale (${thresholdDays}d), estimate, context-switch, neglected-goal, and imbalance signals. Generated ${new Date(generatedAt).toLocaleString()}${evidenceWindow ? ` · Window ${new Date(evidenceWindow.startIso).toLocaleDateString()} → ${new Date(evidenceWindow.endIso).toLocaleDateString()}` : ""}.`}
    >
        {!hasAny ? (
        <EmptyState
          icon={Clock3}
          title="No friction detected"
          description="No blocked, stale, estimate, context-switch, neglected-goal, or imbalance friction found."
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

      {/* Estimate Accuracy */}
      <section className="mt-4">
        <Card className="ega-glass rounded-[1.35rem]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Timer className="h-5 w-5" aria-hidden="true" />
              Estimate Accuracy ({estimateSignals.length})
            </CardTitle>
            <CardDescription>Tasks with meaningful estimate (≥5m) and tracked evidence where actual deviates &gt;50% (medium) or &gt;100% (high). Window-clipped via execution evidence, no double-count.</CardDescription>
          </CardHeader>
          <CardContent>
            {estimateSignals.length === 0 ? (
              <p className="text-sm text-[color:var(--muted-foreground)]">No estimate friction in window.</p>
            ) : (
              <ul className="space-y-3">
                {estimateSignals.map((sig) => (
                  <li key={sig.id} className="ega-glass-soft flex flex-col gap-1 rounded-[1rem] px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium text-[color:var(--foreground)]">{sig.title}</span>
                      <Badge tone={sig.severity === "high" ? "warn" : "muted"}>{sig.percentError}% {sig.status}</Badge>
                    </div>
                    <p className="text-xs text-[color:var(--muted-foreground)]">Est {sig.estimateMinutes}m · Actual {sig.actualMinutes}m · Δ {sig.deltaMinutes}m</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Context Switch */}
      <section className="mt-4">
        <Card className="ega-glass rounded-[1.35rem]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shuffle className="h-5 w-5" aria-hidden="true" />
              Context Switches ({contextSwitch.switchCount})
            </CardTitle>
            <CardDescription>Transitions between different Task ids in ordered sessions (repeat same Task not a switch). Threshold {contextSwitch.threshold} (medium), {contextSwitch.highThreshold} (high).</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[color:var(--muted-foreground)]">
              {contextSwitch.transitionsCount} sessions · {contextSwitch.distinctTaskCount} tasks · {contextSwitch.switchCount} switches · Severity {contextSwitch.severity} {contextSwitch.isFriction ? "· Friction detected" : "· No friction"}
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Neglected Goals */}
      <section className="mt-4">
        <Card className="ega-glass rounded-[1.35rem]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Flag className="h-5 w-5" aria-hidden="true" />
              Neglected Goals ({neglectedGoals.length})
            </CardTitle>
            <CardDescription>Active goals with no tracked execution in window (rolling window from time-context, actual Task/session activity, not just Goal updated_at).</CardDescription>
          </CardHeader>
          <CardContent>
            {neglectedGoals.length === 0 ? (
              <p className="text-sm text-[color:var(--muted-foreground)]">No neglected goals in window.</p>
            ) : (
              <ul className="space-y-3">
                {neglectedGoals.map((goal) => (
                  <li key={goal.id} className="ega-glass-soft flex flex-col gap-1 rounded-[1rem] px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium text-[color:var(--foreground)]">{goal.title}</span>
                      <Badge tone="warn">{goal.daysSinceActivity === null ? "no activity" : `${goal.daysSinceActivity}d`}</Badge>
                    </div>
                    <p className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">Status {goal.status} · Window {new Date(goal.window.startIso).toLocaleDateString()} → {new Date(goal.window.endIso).toLocaleDateString()}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Workload Imbalance */}
      <section className="mt-4">
        <Card className="ega-glass rounded-[1.35rem]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" aria-hidden="true" />
              Workload Imbalance ({workloadImbalance.isImbalance ? workloadImbalance.severity : "none"})
            </CardTitle>
            <CardDescription>Project share from canonical tracked-time aggregation. Threshold {workloadImbalance.threshold}% (med), {workloadImbalance.highThreshold}% (high). Min {workloadImbalance.minTotalMinutes}m total, {workloadImbalance.minForHighMinutes}m for high. Sparse cannot trigger high.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[color:var(--muted-foreground)]">
              {workloadImbalance.projectCount === 0
                ? "No tracked work in window."
                : `${workloadImbalance.totalTrackedMinutes}m total · ${workloadImbalance.projectCount} projects · Dominant ${workloadImbalance.dominantProjectName ?? workloadImbalance.dominantProjectId ?? "—"} ${workloadImbalance.dominantSharePercent}% (${Math.floor(workloadImbalance.dominantTrackedSeconds / 60)}m) · Severity ${workloadImbalance.severity} ${workloadImbalance.isImbalance ? "· Imbalance" : "· Balanced"}`}
            </p>
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
