import type { HealthWorkloadSnapshot } from "@ega/application/health/workload-snapshot";
import type { HealthRecommendation } from "@ega/application/health/recommendations";
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

export function TodayIntelligencePanel({
  health,
  friction,
}: {
  health: HealthResult;
  friction: FrictionResult;
}) {
  const healthRecommendation = health.recommendations[0] ?? null;
  const frictionCount = friction.data ? countFrictionSignals(friction.data) : 0;
  const estimateSignal = friction.data?.estimateSignals[0] ?? null;
  const hasContextSwitch = friction.data?.contextSwitch.isFriction ?? false;

  return (
    <section className="today-intelligence-grid" aria-label="Today intelligence">
      <Card className="today-intelligence-panel">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="glass-label text-etch">Workload</p>
              <CardTitle className="mt-1 text-lg">Health &amp; recovery</CardTitle>
            </div>
            <Activity className="h-5 w-5 text-signal-live" aria-hidden="true" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          {health.errorMessage || !health.data ? (
            <div className="today-intelligence-unavailable" role="status">
              <Badge tone="muted">Unavailable</Badge>
              <p>Workload evidence is unavailable. Your Today plan remains usable.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={health.data.quality.quality === "sufficient" ? "success" : "info"}>
                  {health.data.quality.quality === "sufficient" ? "Evidence ready" : "Evidence limited"}
                </Badge>
                <Badge tone="muted">{health.data.rollingWorkload.totalTrackedLabel} this week</Badge>
              </div>
              <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">
                {healthRecommendation?.message ??
                  (health.data.quality.quality === "insufficient"
                    ? "Track a few sessions to make workload guidance more useful."
                    : "No workload guidance is needed from the available evidence.")}
              </p>
              {healthRecommendation ? (
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--foreground)]">
                  Recommendation · {healthRecommendation.title}
                </p>
              ) : null}
              <p className="text-xs text-[color:var(--muted-foreground)]">
                Workload guidance only — not medical advice.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="today-intelligence-panel">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="glass-label text-etch">Friction</p>
              <CardTitle className="mt-1 text-lg">Keep the lane clear</CardTitle>
            </div>
            <Radar className="h-5 w-5 text-signal-warn" aria-hidden="true" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          {friction.errorMessage || !friction.data ? (
            <div className="today-intelligence-unavailable" role="status">
              <Badge tone="muted">Unavailable</Badge>
              <p>Friction signals are unavailable. Core task execution is unaffected.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={frictionCount > 0 ? "warn" : "success"}>
                  {frictionCount > 0 ? `${frictionCount} signal${frictionCount === 1 ? "" : "s"}` : "No material friction"}
                </Badge>
                {hasContextSwitch ? <Badge tone="warn">Context switching high</Badge> : null}
              </div>
              <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">
                {estimateSignal
                  ? `${estimateSignal.title} is ${Math.abs(estimateSignal.percentError)}% ${estimateSignal.status === "over" ? "over" : "under"} estimate.`
                  : hasContextSwitch
                    ? "Several task transitions are competing for attention. Finish the current task before switching."
                    : frictionCount > 0
                      ? "Review the flagged work before adding more to today."
                      : "Your current work lane is not showing a strong friction pattern."}
              </p>
              {frictionCount > 0 ? (
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--foreground)]">
                  Recommendation · protect one clear next step
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
