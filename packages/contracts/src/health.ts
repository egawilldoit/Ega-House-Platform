/**
 * Health Coach — Workload Snapshot contracts (EGA-501)
 *
 * Lightweight, non-medical workload and recovery snapshot derived from
 * owner-scoped Task session evidence. No wearable data, no new persistence.
 * Quality enum mirrors shared execution-evidence to distinguish
 * sufficient / insufficient / provisional / suspect.
 */

export type HealthEvidenceQualityDto = "sufficient" | "insufficient" | "provisional" | "suspect";

export type HealthWorkloadSnapshotQualityDto = Readonly<{
  quality: HealthEvidenceQualityDto;
  reasons: string[];
  hasOpenSessions: boolean;
  openSessionCount: number;
  malformedCount: number;
  sessionCount: number;
  totalTrackedSeconds: number;
}>;

export type HealthWorkloadSnapshotDto = Readonly<{
  generatedAt: string;
  window: Readonly<{ startIso: string; endIso: string }>;
  timezone: string;
  requestedTimezone: string | null;
  fallback: "none" | "missing_timezone" | "invalid_timezone";
  localDate: string;
  rollingWorkload: Readonly<{
    totalTrackedSeconds: number;
    totalTrackedMinutes: number;
    totalTrackedLabel: string;
  }>;
  activeDays: number;
  windowDays: number;
  sessionCount: number;
  sessionDensity: number;
  longestSessionSeconds: number | null;
  longestSessionLabel: string | null;
  averageSessionSeconds: number | null;
  averageSessionLabel: string | null;
  quality: HealthWorkloadSnapshotQualityDto;
}>;

export type HealthSnapshotRequest = Readonly<{
  timezone?: string;
  includeOpenSessions?: boolean;
}>;

export type HealthRecommendationKindDto = "recovery" | "break" | "movement" | "training";

export type HealthRecommendationSeverityDto = "info" | "nudge" | "guide";

export type HealthRecommendationEvidenceDto = Readonly<{
  metric: string;
  value: number;
  threshold: number;
  unit: "minutes" | "seconds" | "days" | "count" | "density";
  label: string;
  windowDays: number;
  quality: HealthEvidenceQualityDto;
}>;

export type HealthRecommendationDto = Readonly<{
  id: string;
  kind: HealthRecommendationKindDto;
  severity: HealthRecommendationSeverityDto;
  copyKey: string;
  title: string;
  message: string;
  evidence: HealthRecommendationEvidenceDto;
}>;

export type HealthSnapshotResponse = Readonly<{
  ok: true;
  snapshot: HealthWorkloadSnapshotDto;
  recommendations: HealthRecommendationDto[];
}>;

/** GET /health response body. */
export type HealthStatusResponse = Readonly<{ status: "ok" }>;
