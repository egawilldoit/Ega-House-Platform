import type { HealthRecommendation } from "@ega/application/health/recommendations";
import type { HealthWorkloadSnapshot } from "@ega/application/health/workload-snapshot";
import type { FrictionRadarResponse } from "@ega/contracts/friction";
import { Activity, Radar } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
    <section className="review-intelligence-grid" aria-label="Weekly intelligence">
      <Card className="review-intelligence-panel">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="glass-label text-etch">Health</p>
              <CardTitle className="mt-1 text-lg">What the workload means</CardTitle>
            </div>
            <Activity className="h-5 w-5 text-signal-live" aria-hidden="true" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          {health.errorMessage || !health.data ? (
            <div className="review-intelligence-unavailable" role="status">
              <Badge tone="muted">Unavailable</Badge>
              <p>Health evidence is unavailable. The saved review workflow remains available.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={health.data.quality.quality === "sufficient" ? "success" : "info"}>
                  {health.data.quality.quality === "sufficient" ? "Evidence ready" : "Evidence limited"}
                </Badge>
                <Badge tone="muted">{health.data.rollingWorkload.totalTrackedLabel} tracked</Badge>
              </div>
              <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">
                {recommendation?.message ??
                  (health.data.quality.quality === "insufficient"
                    ? "Track more sessions before drawing a workload conclusion."
                    : "No material workload adjustment is indicated by this evidence.")}
              </p>
              <p className="text-xs text-[color:var(--muted-foreground)]">
                Workload guidance only — not medical advice.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="review-intelligence-panel">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="glass-label text-etch">Friction</p>
              <CardTitle className="mt-1 text-lg">What to change next</CardTitle>
            </div>
            <Radar className="h-5 w-5 text-signal-warn" aria-hidden="true" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          {friction.errorMessage || !friction.data ? (
            <div className="review-intelligence-unavailable" role="status">
              <Badge tone="muted">Unavailable</Badge>
              <p>Friction evidence is unavailable. Use the review form to record what you observed.</p>
            </div>
          ) : (
            <>
              <Badge tone={frictionCount > 0 ? "warn" : "success"}>
                {frictionCount > 0 ? `${frictionCount} signal${frictionCount === 1 ? "" : "s"}` : "No material friction"}
              </Badge>
              <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">
                {estimateSignal
                  ? `${estimateSignal.title} is ${Math.abs(estimateSignal.percentError)}% ${estimateSignal.status === "over" ? "over" : "under"} estimate.`
                  : friction.data.contextSwitch.isFriction
                    ? "Context switching was elevated. Protect a clear lane before adding more work."
                    : frictionCount > 0
                      ? "Review the flagged work and choose one adjustment for next week."
                      : "No strong recurring friction pattern was found in the available evidence."}
              </p>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--foreground)]">
                Operator recommendation · {frictionCount > 0 ? "protect one clear next step" : "keep the current rhythm"}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
