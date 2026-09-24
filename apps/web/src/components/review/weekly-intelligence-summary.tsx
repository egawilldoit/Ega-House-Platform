import type { HealthRecommendation } from "@ega/application/health/recommendations";
import type { HealthWorkloadSnapshot } from "@ega/application/health/workload-snapshot";
import type { FrictionRadarResponse } from "@ega/contracts/friction";
import { Activity, Radar } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  formatDisplayDuration,
  formatDisplayDurationDelta,
  formatDisplayMultiple,
  formatDisplayPercent,
} from "@/lib/presentation-format";

type HealthResult = {
  data: HealthWorkloadSnapshot | null;
  recommendations: HealthRecommendation[];
  errorMessage: string | null;
};

type FrictionResult = {
  data: FrictionRadarResponse | null;
  errorMessage: string | null;
};

const HEALTH_GUIDANCE: Record<HealthRecommendation["kind"], string> = {
  recovery: "Consider spacing demanding sessions and planning lighter blocks to keep pace sustainable.",
  break: "A short pause between focus blocks can help keep sessions sustainable.",
  movement: "A short movement or focus block could help rebuild rhythm.",
  training: "A regular short session could help keep momentum.",
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
  const estimateRatio =
    estimateSignal && estimateSignal.estimateMinutes > 0
      ? estimateSignal.actualMinutes / estimateSignal.estimateMinutes
      : null;

  return (
    <div className="grid gap-4 lg:grid-cols-2" aria-label="Weekly intelligence">
      <Card
        label="Health"
        title="Workload"
        action={<Activity className="h-4 w-4 text-ega-text-tertiary" aria-hidden="true" />}
      >
        <CardContent className="flex flex-col gap-3">
          {health.errorMessage || !health.data ? (
            <UnavailableNotice message="Workload guidance is unavailable. The saved review workflow remains available." />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={health.data.quality.quality === "sufficient" ? "success" : "info"}>
                  {health.data.quality.quality === "sufficient" ? "Enough data" : "Limited data"}
                </Badge>
                <Badge tone="muted">
                  {formatDisplayDuration(health.data.rollingWorkload.totalTrackedSeconds, "minute")} tracked this week
                </Badge>
              </div>
              <p className="text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-ega-text-secondary">
                {recommendation
                  ? `${recommendation.title}. ${HEALTH_GUIDANCE[recommendation.kind]}`
                  : health.data.quality.quality === "insufficient"
                    ? "Track more sessions before drawing a workload conclusion."
                    : "No material workload adjustment is needed this week."}
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
            <UnavailableNotice message="Friction signals are unavailable. Use the review form to record what you observed." />
          ) : (
            <>
              <Badge tone={frictionCount > 0 ? "warn" : "success"}>
                {frictionCount > 0 ? `${frictionCount} signal${frictionCount === 1 ? "" : "s"}` : "No material friction"}
              </Badge>
              {estimateSignal && estimateRatio !== null ? (
                <>
                  <p className="text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-ega-text-secondary">
                    {estimateSignal.title} ran {formatDisplayMultiple(estimateRatio)} its estimate (
                    {formatDisplayDurationDelta(estimateSignal.deltaMinutes * 60)}{" "}
                    {estimateSignal.status === "over" ? "over" : "under"}).
                  </p>
                  <p className="text-[length:var(--text-meta)] text-ega-text-tertiary">
                    {formatDisplayPercent(estimateSignal.percentError, { signed: true })} variance
                  </p>
                </>
              ) : (
                <p className="text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-ega-text-secondary">
                  {friction.data.contextSwitch.isFriction
                    ? "Context switching was elevated. Protect a clear lane before adding more work."
                    : frictionCount > 0
                      ? "Review the flagged work and choose one adjustment for next week."
                      : "No strong recurring friction pattern was found this week."}
                </p>
              )}
              <div>
                <p className="glass-label">Recommendation</p>
                <p className="text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-ega-text-secondary">
                  {frictionCount > 0
                    ? "Protect one clear next step for the coming week."
                    : "Keep the current rhythm for the coming week."}
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
