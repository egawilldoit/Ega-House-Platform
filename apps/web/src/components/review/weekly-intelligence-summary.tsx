import type { HealthRecommendation } from "@ega/application/health/recommendations";
import type { HealthWorkloadSnapshot } from "@ega/application/health/workload-snapshot";
import type { FrictionRadarResponse } from "@ega/contracts/friction";
import { Activity, Radar } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type HealthResult = {
  data: HealthWorkloadSnapshot | null;
  recommendations: HealthRecommendation[];
  errorMessage: string | null;
};

type FrictionResult = {
  data: FrictionRadarResponse | null;
  errorMessage: string | null;
};

function countFrictionSignals(data: FrictionRadarResponse) {
  return (
    data.blocked.length +
    data.staleTasks.length +
    data.staleGoals.length +
    data.estimateSignals.length +
    data.neglectedGoals.length +
    (data.contextSwitch.isFriction ? 1 : 0) +
    (data.workloadImbalance.isImbalance ? 1 : 0)
  );
}

function UnavailableNotice({ message }: { message: string }) {
  return (
    <div
      className="flex flex-col items-start gap-2 rounded-[var(--radius-sm)] border border-dashed border-ega-border-strong bg-ega-surface-subtle p-3"
      role="status"
    >
      <Badge tone="muted">Unavailable</Badge>
      <p className="text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-ega-text-secondary">
        {message}
      </p>
    </div>
  );
}

export function WeeklyIntelligenceSummary({
  health,
  friction,
}: {
  health: HealthResult;
  friction: FrictionResult;
}) {
  const recommendation = health.recommendations[0] ?? null;
  const frictionCount = friction.data ? countFrictionSignals(friction.data) : 0;
  const estimateSignal = friction.data?.estimateSignals[0] ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-2" aria-label="Weekly intelligence">
      <Card
        label="Health"
        title="What the workload means"
        action={<Activity className="h-4 w-4 text-status-healthy" aria-hidden="true" />}
      >
        <CardContent className="flex flex-col gap-3">
          {health.errorMessage || !health.data ? (
            <UnavailableNotice message="Health evidence is unavailable. The saved review workflow remains available." />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={health.data.quality.quality === "sufficient" ? "success" : "info"}>
                  {health.data.quality.quality === "sufficient" ? "Evidence ready" : "Evidence limited"}
                </Badge>
                <Badge tone="muted">{health.data.rollingWorkload.totalTrackedLabel} tracked</Badge>
              </div>
              <p className="text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-ega-text-secondary">
                {recommendation?.message ??
                  (health.data.quality.quality === "insufficient"
                    ? "Track more sessions before drawing a workload conclusion."
                    : "No material workload adjustment is indicated by this evidence.")}
              </p>
              <p className="text-[length:var(--text-meta)] text-ega-text-tertiary">
                Workload guidance only — not medical advice.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card
        label="Friction"
        title="What to change next"
        action={<Radar className="h-4 w-4 text-status-risk" aria-hidden="true" />}
      >
        <CardContent className="flex flex-col gap-3">
          {friction.errorMessage || !friction.data ? (
            <UnavailableNotice message="Friction evidence is unavailable. Use the review form to record what you observed." />
          ) : (
            <>
              <Badge tone={frictionCount > 0 ? "warn" : "success"}>
                {frictionCount > 0 ? `${frictionCount} signal${frictionCount === 1 ? "" : "s"}` : "No material friction"}
              </Badge>
              <p className="text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-ega-text-secondary">
                {estimateSignal
                  ? `${estimateSignal.title} is ${Math.abs(estimateSignal.percentError)}% ${estimateSignal.status === "over" ? "over" : "under"} estimate.`
                  : friction.data.contextSwitch.isFriction
                    ? "Context switching was elevated. Protect a clear lane before adding more work."
                    : frictionCount > 0
                      ? "Review the flagged work and choose one adjustment for next week."
                      : "No strong recurring friction pattern was found in the available evidence."}
              </p>
              <p className="glass-label">
                Operator recommendation · {frictionCount > 0 ? "protect one clear next step" : "keep the current rhythm"}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
