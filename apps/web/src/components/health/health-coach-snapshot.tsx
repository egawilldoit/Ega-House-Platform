import type { HealthWorkloadSnapshotDto } from "@ega/contracts/health";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

type Props = {
  snapshot: HealthWorkloadSnapshotDto | null;
  errorMessage?: string | null;
};

function formatQualityLabel(quality: HealthWorkloadSnapshotDto["quality"]["quality"]): string {
  switch (quality) {
    case "sufficient":
      return "Evidence quality: sufficient";
    case "insufficient":
      return "Evidence quality: not enough recent sessions";
    case "provisional":
      return "Evidence quality: provisional — includes an active session";
    case "suspect":
      return "Evidence quality: check data — some sessions were incomplete";
    default:
      return "Evidence quality: unknown";
  }
}

function formatQualityTone(quality: HealthWorkloadSnapshotDto["quality"]["quality"]): "muted" | "info" | "warn" | "success" {
  switch (quality) {
    case "sufficient":
      return "success";
    case "provisional":
      return "info";
    case "suspect":
      return "warn";
    default:
      return "muted";
  }
}

export function HealthCoachSnapshot({ snapshot, errorMessage }: Props) {
  if (errorMessage) {
    return (
      <Card className="border-[var(--border)] bg-white" data-testid="health-coach-error">
        <CardHeader>
          <CardTitle className="text-sm">Workload &amp; Recovery — Snapshot</CardTitle>
          <CardDescription>Lightweight workload guidance from your tracked sessions.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[color:var(--muted-foreground)]">Could not load workload snapshot right now.</p>
        </CardContent>
      </Card>
    );
  }

  if (!snapshot) {
    return (
      <Card className="border-[var(--border)] bg-white" data-testid="health-coach-empty">
        <CardHeader>
          <CardTitle className="text-sm">Workload &amp; Recovery — Snapshot</CardTitle>
          <CardDescription>Lightweight workload guidance from your tracked sessions.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[color:var(--muted-foreground)]">No workload snapshot available.</p>
        </CardContent>
      </Card>
    );
  }

  const isInsufficient = snapshot.quality.quality === "insufficient";
  const isSuspect = snapshot.quality.quality === "suspect";
  const isProvisional = snapshot.quality.quality === "provisional";

  return (
    <Card className="border-[var(--border)] bg-white" data-testid="health-coach-snapshot">
      <CardHeader>
        <CardTitle className="text-sm">Workload &amp; Recovery — Snapshot</CardTitle>
        <CardDescription>
          Based on your tracked work sessions in the last {snapshot.windowDays} days. Workload guidance only — not medical advice.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge tone={formatQualityTone(snapshot.quality.quality)}>{formatQualityLabel(snapshot.quality.quality)}</Badge>
          <Badge tone="muted">{snapshot.timezone} · {snapshot.localDate}</Badge>
        </div>

        {isInsufficient ? (
          <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">
            Not enough recent work to summarize workload yet. Once you track a few sessions, this area will show rolling workload,
            active days, and session patterns to help you pace work and plan recovery breaks.
          </p>
        ) : null}

        {isProvisional ? (
          <p className="text-sm leading-6 text-amber-700">
            Includes time from an active session that has not been stopped yet. Totals will settle once the session is completed.
          </p>
        ) : null}

        {isSuspect ? (
          <p className="text-sm leading-6 text-amber-700">
            Some sessions had incomplete timing data and were excluded. If this persists, check that sessions are stopping cleanly.
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-[var(--border)] p-3">
            <p className="text-xs font-medium text-[color:var(--muted-foreground)]">Rolling workload</p>
            <p className="mt-1 text-sm font-semibold">{snapshot.rollingWorkload.totalTrackedLabel}</p>
            <p className="text-xs text-[color:var(--muted-foreground)]">{snapshot.rollingWorkload.totalTrackedMinutes} min · {snapshot.windowDays}d window</p>
          </div>
          <div className="rounded-md border border-[var(--border)] p-3">
            <p className="text-xs font-medium text-[color:var(--muted-foreground)]">Active days</p>
            <p className="mt-1 text-sm font-semibold">{snapshot.activeDays} of {snapshot.windowDays}</p>
            <p className="text-xs text-[color:var(--muted-foreground)]">{snapshot.sessionDensity} sessions / day</p>
          </div>
          <div className="rounded-md border border-[var(--border)] p-3">
            <p className="text-xs font-medium text-[color:var(--muted-foreground)]">Sessions</p>
            <p className="mt-1 text-sm font-semibold">{snapshot.sessionCount}</p>
            <p className="text-xs text-[color:var(--muted-foreground)]">density {snapshot.sessionDensity}</p>
          </div>
          <div className="rounded-md border border-[var(--border)] p-3">
            <p className="text-xs font-medium text-[color:var(--muted-foreground)]">Longest session</p>
            <p className="mt-1 text-sm font-semibold">{snapshot.longestSessionLabel ?? "—"}</p>
            <p className="text-xs text-[color:var(--muted-foreground)]">in window</p>
          </div>
          <div className="rounded-md border border-[var(--border)] p-3">
            <p className="text-xs font-medium text-[color:var(--muted-foreground)]">Average session</p>
            <p className="mt-1 text-sm font-semibold">{snapshot.averageSessionLabel ?? "—"}</p>
            <p className="text-xs text-[color:var(--muted-foreground)]">per session</p>
          </div>
          <div className="rounded-md border border-[var(--border)] p-3">
            <p className="text-xs font-medium text-[color:var(--muted-foreground)]">Recovery note</p>
            <p className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
              Use recent session patterns to plan breaks and steady workload — not as a health diagnosis.
            </p>
          </div>
        </div>

        <p className="text-xs leading-5 text-[color:var(--muted-foreground)]">
          Window {snapshot.window.startIso.slice(0, 10)} → {snapshot.window.endIso.slice(0, 10)} · Evidence: {snapshot.quality.reasons.join(", ") || "ok"}
        </p>
      </CardContent>
    </Card>
  );
}
