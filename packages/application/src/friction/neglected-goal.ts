import {
  getFrictionNeglectedDaysSinceActivity,
  isActiveFrictionGoal,
} from "@ega/domain/friction";
import type { FrictionNeglectedGoalSignal } from "@ega/contracts/friction";

import {
  calculateExecutionEvidenceForWindow,
  type ExecutionEvidenceSessionRow,
  type ExecutionEvidenceWindow,
} from "../shared/execution-evidence";
import type { FrictionGoalRow } from "./ports";

export type NeglectedGoalOptions = Readonly<{
  nowIso?: string;
  includeOpenSessions?: boolean;
}>;

/**
 * Neglected-goal friction — active goals with no qualifying Task/session
 * activity in the supplied rolling window.
 *
 * Qualifying activity = any tracked session whose Task links to the Goal
 * and whose window-clipped overlap is >0. This consumes canonical
 * execution-evidence aggregation (no second query) and is based on an
 * explicit rolling window derived from EGA-523 time-context (caller-supplied
 * `window.startIso` / `window.endIso`), not Goal `updated_at`.
 *
 * Completed/archived/inactive goal states are excluded via
 * `isActiveFrictionGoal`. Sparse evidence (empty window) yields empty
 * neglected list when there are no goals, but when goals exist and no
 * sessions contribute, every active goal is considered neglected — callers
 * may apply UI-layer minimum-evidence messaging, but domain truth is that
 * no execution occurred.
 *
 * Historical-window fixtures remain stable independent of server timezone
 * because `window` is an explicit ISO range derived from canonical
 * time-context helpers (e.g., `getLocalDayWindow("UTC", "2026-04-20")`),
 * never from process TZ.
 */
export function getNeglectedGoalSignals(
  goals: FrictionGoalRow[],
  sessions: ExecutionEvidenceSessionRow[],
  window: ExecutionEvidenceWindow,
  options: NeglectedGoalOptions & { now?: Date } = {},
): FrictionNeglectedGoalSignal[] {
  const now = options.now ?? (options.nowIso ? new Date(options.nowIso) : new Date());
  const evidence = calculateExecutionEvidenceForWindow(sessions, window, {
    nowIso: options.nowIso ?? now.toISOString(),
    includeOpenSessions: options.includeOpenSessions === true,
  });

  // Map goalId -> last activity timestamp (most recent contributing session end/start)
  // Deterministic: scan all contributing sessions, derive lastActivity as max
  // ended_at (or started_at if ended null but included).
  const lastActivityByGoal = new Map<string, string>();

  // We need to know which sessions actually contributed (>0 overlap).
  // Use trackedSecondsByGoal already computed, but also need timestamp.
  // Re-derive by scanning sessions with overlap >0 and taking max.
  // To avoid double-scan cost we reuse evidence's quality but compute last.
  // Simpler: iterate sessions and use overlap helper via evidence's transitions?
  // We'll instead scan sessions again and compute overlap via
  // calculateExecutionEvidenceForWindow's overlap logic, but we already have
  // the Map from evidence: if goal has trackedSeconds >0, it has activity.
  // For lastActivityAt we find the latest session time among contributing.
  const contributingGoalIds = new Set<string>(evidence.trackedSecondsByGoal.keys());

  // Build lastActivityAtByGoal by finding latest ended_at / started_at among contributing.
  // Since evidence.transitions are ordered by started_at, the last occurrence for a goal
  // is near the end, but we compute max timestamp explicitly for determinism.
  const maxTimeByGoal = new Map<string, number>();

  // We need to know each session's goalId. Use session.tasks?.goals?.id or goal_id.
  // Only count sessions that contributed (i.e., trackedSeconds >0 in window).
  // Use evidence's internal mapping indirectly: we can re-check overlap by
  // looking at whether the session's task's goal is in contributingGoalIds
  // and the session actually overlaps. For precision, we scan transitions
  // which are already filtered to contributing sessions.
  for (const t of evidence.transitions) {
    const goalId = t.goalId;
    if (!goalId) continue;
    if (!contributingGoalIds.has(goalId)) continue;
    // Use t.startedAt as proxy for ordering; for last activity we want the
    // latest time the goal received work — use max of startedAt and endedAt.
    const candidateIso = t.endedAt ?? t.startedAt;
    const candidateMs = new Date(candidateIso).getTime();
    if (Number.isNaN(candidateMs)) continue;
    const currentMax = maxTimeByGoal.get(goalId) ?? Number.NEGATIVE_INFINITY;
    if (candidateMs > currentMax) {
      maxTimeByGoal.set(goalId, candidateMs);
      lastActivityByGoal.set(goalId, candidateIso);
    }
    // Also consider startedAt if ended is before start? Already handled.
  }

  // For goals that had activity but not via transitions goalId (e.g., goalId
  // embedded only in tasks.goals.id fallback path where transition's goalId
  // might be null due to missing tasks.goals.id), we fallback to scanning
  // raw sessions with overlap >0.
  // This handles cases where evidence's goal mapping used tasks.goals.title
  // fallback but not id. For deterministic fallback, scan sessions.
  if (lastActivityByGoal.size !== contributingGoalIds.size) {
    for (const goalId of contributingGoalIds) {
      if (lastActivityByGoal.has(goalId)) continue;
      // Find any session mapping to this goal
      let latest: string | null = null;
      let latestMs = Number.NEGATIVE_INFINITY;
      for (const s of sessions) {
        const taskGoalId = (s.tasks?.goals?.id ?? s.tasks?.goal_id ?? null) as string | null;
        if (taskGoalId !== goalId) continue;
        // Only if this session contributed — we check via evidence's per-task
        // but simpler: if goal in contributing set, at least one session for that
        // goal contributed; we still find the latest among those with valid iso.
        const candidateIso = s.ended_at ?? s.started_at;
        const candidateMs = new Date(candidateIso).getTime();
        if (Number.isNaN(candidateMs)) continue;
        if (candidateMs > latestMs) {
          latestMs = candidateMs;
          latest = candidateIso;
        }
      }
      if (latest) lastActivityByGoal.set(goalId, latest);
    }
  }

  const signals: FrictionNeglectedGoalSignal[] = [];

  for (const goal of goals) {
    if (!isActiveFrictionGoal({ status: goal.status, updatedAt: goal.updatedAt })) continue;

    const hasActivity = contributingGoalIds.has(goal.id);
    if (hasActivity) continue;

    const lastActivityAt = lastActivityByGoal.get(goal.id) ?? null;
    const daysSince = getFrictionNeglectedDaysSinceActivity(lastActivityAt, now);

    signals.push({
      id: goal.id,
      title: goal.title,
      projectId: goal.projectId,
      status: goal.status,
      window: { startIso: window.startIso, endIso: window.endIso },
      lastActivityAt,
      daysSinceActivity: daysSince,
    });
  }

  // Deterministic ordering: most neglected first (null lastActivity oldest), then id.
  signals.sort((a, b) => {
    const aDays = a.daysSinceActivity ?? Number.MAX_SAFE_INTEGER;
    const bDays = b.daysSinceActivity ?? Number.MAX_SAFE_INTEGER;
    if (aDays !== bDays) return bDays - aDays;
    return a.id.localeCompare(b.id);
  });

  return signals;
}
