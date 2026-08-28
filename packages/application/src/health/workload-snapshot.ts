/**
 * Health Coach — Workload / Recovery Snapshot (EGA-501)
 *
 * Lightweight, non-medical read model derived entirely from owner-scoped
 * Task session evidence. Reuses canonical shared execution-evidence and
 * shared time-context; no wearable data and no new persistence.
 *
 * Snapshot fields (per plan H1):
 * - rolling workload (total tracked time in window)
 * - active-work days (distinct days with tracked time)
 * - recent session density (sessions per window day)
 * - longest / average session evidence
 * - explicit data sufficiency (sufficient / insufficient / provisional / suspect)
 *
 * Window boundaries are local-day derived via EGA-523 domain helpers, not
 * server process time. Open-session policy matches execution-evidence:
 * `includeOpenSessions` defaults to `false`; when true, an open session's
 * evidence is clipped to `nowIso` and quality becomes `provisional`
 * (unless `suspect` outranks). Malformed rows → `suspect`.
 */

import { getLocalDayWindow, type LocalDayWindow } from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import {
  calculateExecutionEvidenceForWindow,
  getExecutionEvidenceSessionOverlapSeconds,
  type ExecutionEvidenceRepository,
  type ExecutionEvidenceWindow,
  type EvidenceQuality,
} from "../shared/execution-evidence";
import { formatDurationLabel } from "../shared/duration";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import { resolveTimeContext, type TimeContextRepository } from "../shared/time-context";

export const HEALTH_ROLLING_WINDOW_DAYS = 7;

export type HealthEvidenceQuality = EvidenceQuality;

export type HealthWorkloadSnapshot = Readonly<{
  generatedAt: string;
  window: ExecutionEvidenceWindow;
  timezone: string;
  requestedTimezone: string | null;
  fallback: LocalDayWindow["fallback"];
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
  quality: Readonly<{
    quality: HealthEvidenceQuality;
    reasons: string[];
    hasOpenSessions: boolean;
    openSessionCount: number;
    malformedCount: number;
    sessionCount: number;
    totalTrackedSeconds: number;
  }>;
}>;

function addDaysToIsoDate(dateStr: string, days: number): string {
  const baseMs = Date.UTC(
    Number(dateStr.slice(0, 4)),
    Number(dateStr.slice(5, 7)) - 1,
    Number(dateStr.slice(8, 10)),
  );
  const next = new Date(baseMs + days * 86_400_000);
  const y = String(next.getUTCFullYear()).padStart(4, "0");
  const m = String(next.getUTCMonth() + 1).padStart(2, "0");
  const d = String(next.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function resolveHealthWindow(input: {
  timezone: string;
  localDate: string;
  nowIso: string;
}): ExecutionEvidenceWindow {
  // Rolling window: 7 local calendar days inclusive of today.
  // Start = start of (localDate - 6), End = end of localDate (exclusive).
  // This keeps the window bounded by local-day boundaries from EGA-523,
  // not UTC or server process time.
  const startDate = addDaysToIsoDate(input.localDate, -(HEALTH_ROLLING_WINDOW_DAYS - 1));
  const startWindow = getLocalDayWindow(input.timezone, startDate);
  const endWindow = getLocalDayWindow(input.timezone, input.localDate);
  return {
    startIso: startWindow.startUtcIso,
    endIso: endWindow.endUtcIso,
  };
}

export type HealthSnapshotOptions = Readonly<{
  now?: Date;
  requestedTimezone?: unknown;
  includeOpenSessions?: boolean;
}>;

export async function getHealthWorkloadSnapshot(
  actor: AuthenticatedActor,
  timeContextRepository: TimeContextRepository,
  executionEvidenceRepository: ExecutionEvidenceRepository,
  options: HealthSnapshotOptions = {},
): Promise<ApplicationResult<HealthWorkloadSnapshot>> {
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    return applicationFailure("Current time is invalid.");
  }
  const nowIso = now.toISOString();
  const includeOpenSessions = options.includeOpenSessions === true;

  const timeResult = await resolveTimeContext(actor, timeContextRepository, {
    requestedTimezone: options.requestedTimezone,
    now,
  });
  if (!timeResult.ok) {
    return applicationFailure(timeResult.errorMessage);
  }

  const { timezone, requestedTimezone, fallback, localDate } = timeResult.data;

  let window: ExecutionEvidenceWindow;
  try {
    window = resolveHealthWindow({ timezone, localDate, nowIso });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to resolve health window.";
    return applicationFailure(message);
  }

  const sessionsResult = await executionEvidenceRepository.listSessionsForWindow(actor, window, {
    limit: 2000,
  });
  if (!sessionsResult.ok) {
    return applicationFailure("Unable to load health snapshot right now.");
  }

  const sessions = sessionsResult.value ?? [];

  const evidence = calculateExecutionEvidenceForWindow(sessions, window, {
    nowIso,
    includeOpenSessions,
  });

  // Derive longest / average from per-session overlap (clipped to window).
  // We use the same includeOpenSessions policy so provisional evidence is
  // consistent with quality.
  let longestSeconds: number | null = null;

  for (const session of sessions) {
    const overlap = getExecutionEvidenceSessionOverlapSeconds(session, window, {
      nowIso,
      includeOpenSessions,
    });
    if (overlap <= 0) continue;
    if (longestSeconds === null || overlap > longestSeconds) {
      longestSeconds = overlap;
    }
  }

  // Average is total tracked / sessionCount (both from evidence which already
  // counts only contributing sessions). Fall back to per-session sum to keep
  // consistency with longest calculation.
  const totalTrackedSeconds = evidence.totalTrackedSeconds;
  const sessionCount = evidence.sessionCount;
  const activeDays = evidence.trackedSecondsByDay.size; // distinct UTC days; window itself is local-derived
  const windowDays = HEALTH_ROLLING_WINDOW_DAYS;
  const sessionDensity = windowDays > 0 ? Number((sessionCount / windowDays).toFixed(2)) : 0;

  const averageSeconds =
    sessionCount > 0 ? Math.floor(totalTrackedSeconds / sessionCount) : null;

  const snapshot: HealthWorkloadSnapshot = {
    generatedAt: nowIso,
    window,
    timezone,
    requestedTimezone,
    fallback,
    localDate,
    rollingWorkload: {
      totalTrackedSeconds,
      totalTrackedMinutes: Math.floor(totalTrackedSeconds / 60),
      totalTrackedLabel: formatDurationLabel(totalTrackedSeconds),
    },
    activeDays,
    windowDays,
    sessionCount,
    sessionDensity,
    longestSessionSeconds: longestSeconds,
    longestSessionLabel: longestSeconds !== null ? formatDurationLabel(longestSeconds) : null,
    averageSessionSeconds: averageSeconds,
    averageSessionLabel: averageSeconds !== null ? formatDurationLabel(averageSeconds) : null,
    quality: {
      quality: evidence.quality.quality,
      reasons: [...evidence.quality.reasons],
      hasOpenSessions: evidence.quality.hasOpenSessions,
      openSessionCount: evidence.quality.openSessionCount,
      malformedCount: evidence.quality.malformedCount,
      sessionCount: evidence.quality.sessionCount,
      totalTrackedSeconds: evidence.quality.totalTrackedSeconds,
    },
  };

  return applicationSuccess(snapshot);
}

// ---------------------------------------------------------------------------
// Helpers for tests / contracts mapping
// ---------------------------------------------------------------------------

export function mapHealthSnapshotToContractModel(snapshot: HealthWorkloadSnapshot): Readonly<{
  generatedAt: string;
  window: ExecutionEvidenceWindow;
  timezone: string;
  requestedTimezone: string | null;
  fallback: LocalDayWindow["fallback"];
  localDate: string;
  rollingWorkload: HealthWorkloadSnapshot["rollingWorkload"];
  activeDays: number;
  windowDays: number;
  sessionCount: number;
  sessionDensity: number;
  longestSessionSeconds: number | null;
  longestSessionLabel: string | null;
  averageSessionSeconds: number | null;
  averageSessionLabel: string | null;
  quality: HealthWorkloadSnapshot["quality"];
}> {
  return snapshot;
}
