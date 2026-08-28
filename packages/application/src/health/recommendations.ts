/**
 * Health Coach — Deterministic Recommendations (EGA-502)
 *
 * Pure, deterministic rules that convert a workload snapshot into
 * workload-oriented, non-medical guidance. No mutation, no IO.
 * Thresholds live here (shared policy), never in React/Expo/Hono.
 *
 * Each recommendation carries severity, evidence (actual tracked value
 * that triggered it), copyKey and non-medical message.
 *
 * Determinism: same snapshot => same recommendations, stable order.
 * Guard: only `sufficient` quality produces confident claims; sparse
 * data (insufficient/provisional/suspect) yields no actionable guidance.
 */

import type { HealthWorkloadSnapshot } from "./workload-snapshot";

// Thresholds — shared policy, single source of truth.
export const HEALTH_RECOMMENDATION_THRESHOLDS = {
  // Rolling workload over 7d window
  highWorkloadMinutes: 600, // 10h in 7d
  veryHighWorkloadMinutes: 900, // 15h in 7d
  // Session length
  longSessionMinutes: 90,
  veryLongSessionMinutes: 120,
  // Inactivity / low activity
  lowActiveDays: 2,
  lowTotalMinutes: 90, // <= 1.5h in 7d is low
  lowSessionDensity: 0.43,
} as const;

export type HealthRecommendationKind = "recovery" | "break" | "movement" | "training";

export type HealthRecommendationSeverity = "info" | "nudge" | "guide";

export type HealthRecommendationEvidence = Readonly<{
  metric: string;
  value: number;
  threshold: number;
  unit: "minutes" | "seconds" | "days" | "count" | "density";
  label: string;
  windowDays: number;
  quality: HealthWorkloadSnapshot["quality"]["quality"];
}>;

export type HealthRecommendation = Readonly<{
  id: string;
  kind: HealthRecommendationKind;
  severity: HealthRecommendationSeverity;
  copyKey: string;
  title: string;
  message: string;
  evidence: HealthRecommendationEvidence;
}>;

// Ranking for deterministic ordering (lower = earlier). Stable secondary sort by id.
const KIND_RANK: Record<HealthRecommendationKind, number> = {
  recovery: 1,
  break: 2,
  movement: 3,
  training: 4,
};

const SEVERITY_RANK: Record<HealthRecommendationSeverity, number> = {
  guide: 1,
  nudge: 2,
  info: 3,
};

function formatMinutesLabel(minutes: number): string {
  return `${minutes} min`;
}

function formatSecondsLabel(seconds: number): string {
  if (seconds >= 3600) return `${Math.floor(seconds / 60)} min`;
  return `${Math.floor(seconds / 60)} min`;
}

export function getHealthRecommendations(snapshot: HealthWorkloadSnapshot): HealthRecommendation[] {
  // Minimum-evidence guard: only sufficient evidence yields confident claims.
  // Provisional / suspect / insufficient -> no actionable recommendations.
  if (snapshot.quality.quality !== "sufficient") {
    return [];
  }

  const results: HealthRecommendation[] = [];
  const windowDays = snapshot.windowDays;

  // --- Rule 1: recovery — high rolling workload ---
  {
    const totalMinutes = snapshot.rollingWorkload.totalTrackedMinutes;
    const t = HEALTH_RECOMMENDATION_THRESHOLDS;
    if (totalMinutes >= t.highWorkloadMinutes) {
      const veryHigh = totalMinutes >= t.veryHighWorkloadMinutes;
      const evidence: HealthRecommendationEvidence = {
        metric: "rollingWorkload.totalTrackedMinutes",
        value: totalMinutes,
        threshold: veryHigh ? t.veryHighWorkloadMinutes : t.highWorkloadMinutes,
        unit: "minutes",
        label: `${totalMinutes} min in ${windowDays}d`,
        windowDays,
        quality: snapshot.quality.quality,
      };
      results.push({
        id: "health.recommendation.recovery_high_workload",
        kind: "recovery",
        severity: veryHigh ? "guide" : "nudge",
        copyKey: "health.recommendation.recovery_high_workload",
        title: "Steady workload this week",
        message: veryHigh
          ? `Tracked workload was ${formatMinutesLabel(totalMinutes)} over the last ${windowDays} days — consider spacing demanding sessions and planning lighter blocks to keep pace sustainable. Based on ${totalMinutes} min tracked (threshold ${evidence.threshold} min).`
          : `Tracked workload was ${formatMinutesLabel(totalMinutes)} over the last ${windowDays} days — a lighter block or extra pause between sessions could help keep pace steady. Based on ${totalMinutes} min tracked (threshold ${evidence.threshold} min).`,
        evidence,
      });
    }
  }

  // --- Rule 2: break — long single session suggests planning pauses ---
  {
    const longest = snapshot.longestSessionSeconds;
    const t = HEALTH_RECOMMENDATION_THRESHOLDS;
    if (longest !== null && longest >= t.longSessionMinutes * 60) {
      const veryLong = longest >= t.veryLongSessionMinutes * 60;
      const longestMinutes = Math.floor(longest / 60);
      const thresholdMinutes = veryLong ? t.veryLongSessionMinutes : t.longSessionMinutes;
      const evidence: HealthRecommendationEvidence = {
        metric: "longestSessionSeconds",
        value: longest,
        threshold: thresholdMinutes * 60,
        unit: "seconds",
        label: `${longestMinutes} min longest session`,
        windowDays,
        quality: snapshot.quality.quality,
      };
      results.push({
        id: "health.recommendation.break_long_session",
        kind: "break",
        severity: veryLong ? "guide" : "nudge",
        copyKey: "health.recommendation.break_long_session",
        title: "Long focus session",
        message: veryLong
          ? `Longest continuous session was about ${longestMinutes} min — try a brief pause and reset between extended focus blocks. Based on longest session ${longestMinutes} min (threshold ${thresholdMinutes} min).`
          : `Longest session ran about ${longestMinutes} min — a short pause between focus blocks can help keep sessions sustainable. Based on longest session ${longestMinutes} min (threshold ${thresholdMinutes} min).`,
        evidence,
      });
    }
  }

  // --- Rule 3: movement — low active days / low total suggests movement nudge ---
  {
    const t = HEALTH_RECOMMENDATION_THRESHOLDS;
    const totalMinutes = snapshot.rollingWorkload.totalTrackedMinutes;
    const activeDays = snapshot.activeDays;
    // Low activity: few active days and low total minutes (but sufficient quality means we have window coverage)
    // Use both signals to avoid flagging a single low day when total is actually high.
    if (activeDays <= t.lowActiveDays && totalMinutes <= t.lowTotalMinutes) {
      const evidence: HealthRecommendationEvidence = {
        metric: "activeDays",
        value: activeDays,
        threshold: t.lowActiveDays,
        unit: "days",
        label: `${activeDays} active day${activeDays === 1 ? "" : "s"} in ${windowDays}d · ${totalMinutes} min total`,
        windowDays,
        quality: snapshot.quality.quality,
      };
      results.push({
        id: "health.recommendation.movement_low_activity",
        kind: "movement",
        severity: activeDays === 0 ? "nudge" : "nudge",
        copyKey: "health.recommendation.movement_low_activity",
        title: "Low activity this week",
        message: `Only ${activeDays} active day${activeDays === 1 ? "" : "s"} in the last ${windowDays} (${formatMinutesLabel(totalMinutes)} total) — a short movement or focus block could help rebuild rhythm. Based on ${activeDays} active day${activeDays === 1 ? "" : "s"} (threshold ≤${t.lowActiveDays}) and ${totalMinutes} min (threshold ≤${t.lowTotalMinutes} min).`,
        evidence,
      });
    }
  }

  // --- Rule 4: training — low session density suggests steady rhythm ---
  {
    const t = HEALTH_RECOMMENDATION_THRESHOLDS;
    const density = snapshot.sessionDensity;
    // Only emit training when density is meaningfully low and not already covered by movement (to keep deduplication predictable)
    // But allow both if they are distinct kinds — ordering handles it.
    if (density <= t.lowSessionDensity) {
      // Guard: avoid training nudge when workload is already high (recovery already signals) — keep recommendations complementary.
      const totalMinutes = snapshot.rollingWorkload.totalTrackedMinutes;
      if (totalMinutes < t.highWorkloadMinutes) {
        const evidence: HealthRecommendationEvidence = {
          metric: "sessionDensity",
          value: density,
          threshold: t.lowSessionDensity,
          unit: "density",
          label: `${density} sessions/day in ${windowDays}d`,
          windowDays,
          quality: snapshot.quality.quality,
        };
        results.push({
          id: "health.recommendation.training_low_density",
          kind: "training",
          severity: density <= 0.2 ? "guide" : "nudge",
          copyKey: "health.recommendation.training_low_density",
          title: "Light session rhythm",
          message: `Session density is ${density}/day this week — a regular short session could help keep momentum. Based on density ${density}/day (threshold ≤${t.lowSessionDensity}/day).`,
          evidence,
        });
      }
    }
  }

  // Deduplicate by id (should already be unique per kind, but guard) and order predictably.
  const seen = new Set<string>();
  const deduped: HealthRecommendation[] = [];
  for (const r of results) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      deduped.push(r);
    }
  }

  // Deterministic ordering: by kind rank, then severity rank, then id lexicographically.
  deduped.sort((a, b) => {
    const kindDiff = (KIND_RANK[a.kind] ?? 99) - (KIND_RANK[b.kind] ?? 99);
    if (kindDiff !== 0) return kindDiff;
    const sevDiff = (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99);
    if (sevDiff !== 0) return sevDiff;
    return a.id.localeCompare(b.id);
  });

  return deduped;
}

export function mapHealthRecommendationToContractModel(r: HealthRecommendation): Readonly<{
  id: string;
  kind: HealthRecommendationKind;
  severity: HealthRecommendationSeverity;
  copyKey: string;
  title: string;
  message: string;
  evidence: HealthRecommendationEvidence;
}> {
  return r;
}
