import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getFrictionRadar } from "@/lib/services/friction-service";
import { AlertTriangle, PauseCircle, Clock3, Timer, Shuffle, Flag, BarChart3 } from "lucide-react";

export const dynamic = "force-dynamic";

type FrictionSeverity = "none" | "low" | "medium" | "high";

const SEVERITY_LABEL: Record<FrictionSeverity, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
};

function severityTone(severity: FrictionSeverity) {
  if (severity === "high") {
    return "error" as const;
  }
  if (severity === "medium") {
    return "warn" as const;
  }
  return "muted" as const;
}

function AgeBadge({ days }: { days: number }) {
  return (
    <Badge tone={days >= 7 ? "warn" : "muted"}>
      {days}d<span className="sr-only"> ago</span>
    </Badge>
  );
}

function SeverityBadge({ severity }: { severity: FrictionSeverity }) {
  return <Badge tone={severityTone(severity)}>{SEVERITY_LABEL[severity]}</Badge>;
}

function EmptyPanelRow({ children }: { children: string }) {
  return (
    <CardContent>
      <p className="text-[length:var(--text-meta-lg)] text-ega-text-secondary">{children}</p>
    </CardContent>
  );
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
      title="Workflow Friction"
      description={`Deterministic stale (${thresholdDays}d), estimate, context-switch, neglected-goal, and imbalance signals. Generated ${new Date(generatedAt).toLocaleString()}${evidenceWindow ? ` · Window ${new Date(evidenceWindow.startIso).toLocaleDateString()} → ${new Date(evidenceWindow.endIso).toLocaleDateString()}` : ""}.`}
    >
      <DashboardSection
        title="Signal summary"
        description="Real counts from the current friction read model."
      >
        <div className="kpi-grid">
          <StatCard label="Blocked" value={blocked.length} subtitle="active blocked tasks" />
          <StatCard
            label="Stale tasks"
            value={staleTasks.length}
            subtitle={`no update ≥ ${thresholdDays}d`}
          />
          <StatCard
            label="Stale goals"
            value={staleGoals.length}
            subtitle={`no update ≥ ${thresholdDays}d`}
          />
          <StatCard
            label="Estimate signals"
            value={estimateSignals.length}
            subtitle="deviations in window"
          />
          <StatCard
            label="Context switches"
            value={contextSwitch.switchCount}
            subtitle="task transitions"
          />
          <StatCard
            label="Neglected goals"
            value={neglectedGoals.length}
            subtitle="no tracked activity"
          />
        </div>
      </DashboardSection>

      {!hasAny ? (
        <Card>
          <EmptyState
            icon={Clock3}
            title="No friction detected"
            description="No blocked, stale, estimate, context-switch, neglected-goal, or imbalance friction found."
          />
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PauseCircle className="h-4 w-4 text-ega-text-tertiary" aria-hidden="true" />
            Blocked
            <Badge tone="error">{blocked.length}</Badge>
          </CardTitle>
          <CardDescription>Active tasks with status Blocked — includes blocker reason when present and age.</CardDescription>
        </CardHeader>
        {blocked.length === 0 ? (
          <EmptyPanelRow>No blocked tasks.</EmptyPanelRow>
        ) : (
          <ul className="rows">
            {blocked.map((task) => (
              <li key={task.id} className="row">
                <span className="row-main self-start">
                  <span className="row-title">{task.title}</span>
                  <span className="row-meta">
                    {task.blockedReason ? `Reason: ${task.blockedReason}` : "No blocker reason provided"}
                  </span>
                  <span className="row-meta">
                    Updated {new Date(task.updatedAt).toLocaleDateString()}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 self-start">
                  <StatusBadge status={task.status} />
                  <AgeBadge days={task.ageDays} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-ega-text-tertiary" aria-hidden="true" />
            Stale Tasks
            <Badge tone="warn">{staleTasks.length}</Badge>
          </CardTitle>
          <CardDescription>
            Active tasks with no update for ≥ {thresholdDays} days.
          </CardDescription>
        </CardHeader>
        {staleTasks.length === 0 ? (
          <EmptyPanelRow>No stale tasks.</EmptyPanelRow>
        ) : (
          <ul className="rows">
            {staleTasks.map((task) => (
              <li key={task.id} className="row">
                <span className="row-main self-start">
                  <span className="row-title">{task.title}</span>
                  <span className="row-meta">
                    Updated {new Date(task.updatedAt).toLocaleDateString()}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 self-start">
                  <StatusBadge status={task.status} />
                  <AgeBadge days={task.ageDays} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-ega-text-tertiary" aria-hidden="true" />
            Stale Goals
            <Badge tone="warn">{staleGoals.length}</Badge>
          </CardTitle>
          <CardDescription>Active goals with no update for ≥ {thresholdDays} days.</CardDescription>
        </CardHeader>
        {staleGoals.length === 0 ? (
          <EmptyPanelRow>No stale goals.</EmptyPanelRow>
        ) : (
          <ul className="rows">
            {staleGoals.map((goal) => (
              <li key={goal.id} className="row">
                <span className="row-main self-start">
                  <span className="row-title">{goal.title}</span>
                  <span className="row-meta">
                    Updated {new Date(goal.updatedAt).toLocaleDateString()}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 self-start">
                  <StatusBadge status={goal.status} />
                  <AgeBadge days={goal.ageDays} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Timer className="h-4 w-4 text-ega-text-tertiary" aria-hidden="true" />
            Estimate Accuracy
            <Badge tone="muted">{estimateSignals.length}</Badge>
          </CardTitle>
          <CardDescription>Tasks with meaningful estimate (≥5m) and tracked evidence where actual deviates &gt;50% (medium) or &gt;100% (high). Window-clipped via execution evidence, no double-count.</CardDescription>
        </CardHeader>
        {estimateSignals.length === 0 ? (
          <EmptyPanelRow>No estimate friction in window.</EmptyPanelRow>
        ) : (
          <ul className="rows">
            {estimateSignals.map((sig) => (
              <li key={sig.id} className="row">
                <span className="row-main self-start">
                  <span className="row-title">{sig.title}</span>
                  <span className="row-meta">
                    Est {sig.estimateMinutes}m · Actual {sig.actualMinutes}m · Δ {sig.deltaMinutes}m
                  </span>
                  <span className="row-meta">
                    {sig.percentError}% deviation · {sig.status}
                  </span>
                </span>
                <SeverityBadge severity={sig.severity} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shuffle className="h-4 w-4 text-ega-text-tertiary" aria-hidden="true" />
            Context Switches
            <Badge tone={contextSwitch.isFriction ? "warn" : "muted"}>
              {contextSwitch.switchCount}
            </Badge>
          </CardTitle>
          <CardDescription>Transitions between different Task ids in ordered sessions (repeat same Task not a switch). Threshold {contextSwitch.threshold} (medium), {contextSwitch.highThreshold} (high).</CardDescription>
        </CardHeader>
        <dl className="rows">
          <div className="row">
            <dt className="flex-1 text-[length:var(--text-meta-lg)] text-ega-text-secondary">Sessions</dt>
            <dd className="tabular-nums text-[length:var(--text-body)] font-medium text-ega-text">
              {contextSwitch.transitionsCount}
            </dd>
          </div>
          <div className="row">
            <dt className="flex-1 text-[length:var(--text-meta-lg)] text-ega-text-secondary">Distinct tasks</dt>
            <dd className="tabular-nums text-[length:var(--text-body)] font-medium text-ega-text">
              {contextSwitch.distinctTaskCount}
            </dd>
          </div>
          <div className="row">
            <dt className="flex-1 text-[length:var(--text-meta-lg)] text-ega-text-secondary">Switches</dt>
            <dd className="tabular-nums text-[length:var(--text-body)] font-medium text-ega-text">
              {contextSwitch.switchCount}
            </dd>
          </div>
          <div className="row">
            <dt className="flex-1 text-[length:var(--text-meta-lg)] text-ega-text-secondary">Severity</dt>
            <dd className="flex items-center gap-2 text-[length:var(--text-body)] font-medium text-ega-text">
              <SeverityBadge severity={contextSwitch.severity} />
              {contextSwitch.isFriction ? "Friction detected" : "No friction"}
            </dd>
          </div>
        </dl>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Flag className="h-4 w-4 text-ega-text-tertiary" aria-hidden="true" />
            Neglected Goals
            <Badge tone="warn">{neglectedGoals.length}</Badge>
          </CardTitle>
          <CardDescription>Active goals with no tracked execution in window (rolling window from time-context, actual Task/session activity, not just Goal updated_at).</CardDescription>
        </CardHeader>
        {neglectedGoals.length === 0 ? (
          <EmptyPanelRow>No neglected goals in window.</EmptyPanelRow>
        ) : (
          <ul className="rows">
            {neglectedGoals.map((goal) => (
              <li key={goal.id} className="row">
                <span className="row-main self-start">
                  <span className="row-title">{goal.title}</span>
                  <span className="row-meta">
                    Window {new Date(goal.window.startIso).toLocaleDateString()} →{" "}
                    {new Date(goal.window.endIso).toLocaleDateString()}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 self-start">
                  <StatusBadge status={goal.status} />
                  <Badge tone="warn">
                    {goal.daysSinceActivity === null ? "no activity" : `${goal.daysSinceActivity}d`}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-ega-text-tertiary" aria-hidden="true" />
            Workload Imbalance
            <SeverityBadge severity={workloadImbalance.severity} />
          </CardTitle>
          <CardDescription>Project share from canonical tracked-time aggregation. Threshold {workloadImbalance.threshold}% (med), {workloadImbalance.highThreshold}% (high). Min {workloadImbalance.minTotalMinutes}m total, {workloadImbalance.minForHighMinutes}m for high. Sparse cannot trigger high.</CardDescription>
        </CardHeader>
        {workloadImbalance.projectCount === 0 ? (
          <EmptyPanelRow>No tracked work in window.</EmptyPanelRow>
        ) : (
          <dl className="rows">
            <div className="row">
              <dt className="flex-1 text-[length:var(--text-meta-lg)] text-ega-text-secondary">Total tracked</dt>
              <dd className="tabular-nums text-[length:var(--text-body)] font-medium text-ega-text">
                {workloadImbalance.totalTrackedMinutes}m
              </dd>
            </div>
            <div className="row">
              <dt className="flex-1 text-[length:var(--text-meta-lg)] text-ega-text-secondary">Projects</dt>
              <dd className="tabular-nums text-[length:var(--text-body)] font-medium text-ega-text">
                {workloadImbalance.projectCount}
              </dd>
            </div>
            <div className="row">
              <dt className="flex-1 text-[length:var(--text-meta-lg)] text-ega-text-secondary">Dominant project</dt>
              <dd className="min-w-0 truncate text-[length:var(--text-body)] font-medium text-ega-text">
                {workloadImbalance.dominantProjectName ?? workloadImbalance.dominantProjectId ?? "—"}
              </dd>
            </div>
            <div className="row">
              <dt className="flex-1 text-[length:var(--text-meta-lg)] text-ega-text-secondary">Dominant share</dt>
              <dd className="tabular-nums text-[length:var(--text-body)] font-medium text-ega-text">
                {workloadImbalance.dominantSharePercent}% (
                {Math.floor(workloadImbalance.dominantTrackedSeconds / 60)}m)
              </dd>
            </div>
            <div className="row">
              <dt className="flex-1 text-[length:var(--text-meta-lg)] text-ega-text-secondary">Severity</dt>
              <dd className="flex items-center gap-2 text-[length:var(--text-body)] font-medium text-ega-text">
                <SeverityBadge severity={workloadImbalance.severity} />
                {workloadImbalance.isImbalance ? "Imbalance" : "Balanced"}
              </dd>
            </div>
          </dl>
        )}
      </Card>
    </AppShell>
  );
}
