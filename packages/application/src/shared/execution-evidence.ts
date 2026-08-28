/**
 * Canonical Shared Execution Evidence — session/window aggregation.
 *
 * Owner: @ega/application (pure, framework-independent).
 * Data-access owns retrieval; this module owns semantics.
 *
 * Policy documented here is the single source of truth and is intentionally
 * explicit so every intelligence feature (Health Coach, Friction Radar,
 * Weekly Review, Daily Operator) shares the same bounded execution truth.
 *
 * ## Open-session policy
 * - **includeOnlyClosed by default.** `includeOpenSessions` defaults to `false`.
 *   An open session (`ended_at === null`) contributes `0` unless the caller
 *   explicitly opts in.
 * - When `includeOpenSessions: true`, an open session's effective end is
 *   `nowIso` (caller-supplied clock) and any window overlap is counted.
 * - If at least one open session contributes when `includeOpenSessions: true`,
 *   evidence quality is `provisional` (unless a stronger `suspect` reason
 *   applies). Open sessions never silently count.
 *
 * ## Window overlap
 * - Window is explicit `{ startIso, endIso }` in ISO-8601 UTC. The interval
 *   is half-open `[start, end)`. Sessions that merely touch a boundary
 *   (`ended_at === window.startIso` or `started_at === window.endIso`)
 *   contribute `0`.
 * - Overlap is `max(sessionStart, windowStart)` → `min(sessionEnd, windowEnd)`.
 * - Malformed ISOs, `end < start`, or `window.end <= window.start` yield `0`
 *   for that session and are counted as malformed (quality → `suspect`).
 * - No fallback to `duration_seconds` for overlap; that column is only a
 *   persistence convenience for closed sessions.
 *
 * ## No double-count
 * - Within a single window aggregation, `totalTrackedSeconds` is the sum of
 *   each session's *clipped* overlap. Sessions are counted once. Callers that
 *   aggregate across *different* windows must not sum window totals that
 *   overlap in time without deduplicating intervals.
 *
 * ## Deterministic ordering
 * - Ordered transitions are sorted by `started_at` ascending (UTC ms), then
 *   `task_id` lexicographically, then `id` lexicographically. This makes
 *   equal-timestamp sessions deterministic for context-switch calculations.
 *
 * ## Evidence quality
 * - `sufficient` — at least one closed session contributed, no open or
 *   malformed contribution.
 * - `insufficient` — zero contributing sessions (empty, zero-data, or only
 *   zero-overlap sessions) and not suspect/provisional.
 * - `provisional` — at least one *included* open session contributed.
 * - `suspect` — at least one malformed session row or a malformed window.
 *   `suspect` outranks `provisional`.
 */

export type ExecutionEvidenceWindow = Readonly<{
  startIso: string;
  endIso: string;
}>;

export type ExecutionEvidenceSessionTask = {
  id?: string | null;
  title?: string | null;
  project_id?: string | null;
  goal_id?: string | null;
  estimate_minutes?: number | null;
  projects?: { id?: string | null; name?: string | null } | null;
  goals?: { id?: string | null; title?: string | null } | null;
} | null;

export type ExecutionEvidenceSessionRow = Readonly<{
  id?: string;
  task_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  tasks?: ExecutionEvidenceSessionTask;
}>;

export type ExecutionEvidenceOptions = Readonly<{
  nowIso?: string;
  includeOpenSessions?: boolean;
}>;

export type EvidenceQuality = "sufficient" | "insufficient" | "provisional" | "suspect";

export type ExecutionEvidenceQuality = Readonly<{
  quality: EvidenceQuality;
  reasons: string[];
  hasOpenSessions: boolean;
  openSessionCount: number;
  malformedCount: number;
  sessionCount: number;
  totalTrackedSeconds: number;
}>;

export type ExecutionEvidenceTimeBucket = Readonly<{
  id: string;
  label: string;
  trackedSeconds: number;
  sessionCount: number;
}>;

export type OrderedSessionTransition = Readonly<{
  index: number;
  taskId: string;
  startedAt: string;
  endedAt: string | null;
  projectId: string | null;
  goalId: string | null;
  trackedSeconds: number;
  sessionId: string | null;
}>;

export type ExecutionEvidenceSummary = Readonly<{
  window: ExecutionEvidenceWindow;
  totalTrackedSeconds: number;
  trackedSecondsByTask: Map<string, number>;
  trackedSecondsByProject: Map<string, number>;
  trackedSecondsByGoal: Map<string, number>;
  trackedSecondsByDay: Map<string, number>;
  taskTimeBuckets: ExecutionEvidenceTimeBucket[];
  projectTimeBuckets: ExecutionEvidenceTimeBucket[];
  goalTimeBuckets: ExecutionEvidenceTimeBucket[];
  dayTimeBuckets: ExecutionEvidenceTimeBucket[];
  touchedProjectNames: string[];
  touchedGoalTitles: string[];
  sessionCount: number;
  openSessionCount: number;
  malformedCount: number;
  quality: ExecutionEvidenceQuality;
  transitions: OrderedSessionTransition[];
}>;

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function toMs(iso: string): number | null {
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : null;
}

function isValidIso(iso: string): boolean {
  return toMs(iso) !== null;
}

function getTaskId(session: ExecutionEvidenceSessionRow): string {
  return (session.tasks?.id as string | undefined) ?? session.task_id;
}

function isMalformedSession(session: ExecutionEvidenceSessionRow): boolean {
  const startMs = toMs(session.started_at);
  if (startMs === null) return true;
  if (session.ended_at !== null && session.ended_at !== undefined) {
    const endMs = toMs(session.ended_at);
    if (endMs === null) return true;
    if (endMs < startMs) return true;
  }
  return false;
}

function isMalformedWindow(window: ExecutionEvidenceWindow): boolean {
  const startMs = toMs(window.startIso);
  const endMs = toMs(window.endIso);
  if (startMs === null || endMs === null) return true;
  if (endMs <= startMs) return true;
  return false;
}

function resolveNowIso(nowIso: string | undefined): string {
  if (nowIso && isValidIso(nowIso)) return nowIso;
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Core overlap — canonical for this module and re-exported duration helpers.
// ---------------------------------------------------------------------------

/**
 * Returns the number of whole seconds of `session` that fall inside `window`.
 * Returns 0 for malformed timestamps, zero-overlap, and (by default) open
 * sessions. See module header for policy.
 */
export function getExecutionEvidenceSessionOverlapSeconds(
  session: ExecutionEvidenceSessionRow,
  window: ExecutionEvidenceWindow,
  options: ExecutionEvidenceOptions = {},
): number {
  const includeOpen = options.includeOpenSessions === true;
  if (!includeOpen && (session.ended_at === null || session.ended_at === undefined)) {
    return 0;
  }

  const nowIso = resolveNowIso(options.nowIso);
  const sessionStartMs = toMs(session.started_at);
  const sessionEndMs = session.ended_at ? toMs(session.ended_at) : toMs(nowIso);
  const windowStartMs = toMs(window.startIso);
  const windowEndMs = toMs(window.endIso);

  if (
    sessionStartMs === null ||
    sessionEndMs === null ||
    windowStartMs === null ||
    windowEndMs === null
  ) {
    return 0;
  }

  if (sessionEndMs < sessionStartMs) return 0;
  if (windowEndMs <= windowStartMs) return 0;

  const overlapStart = Math.max(sessionStartMs, windowStartMs);
  const overlapEnd = Math.min(sessionEndMs, windowEndMs);

  if (overlapEnd <= overlapStart) return 0;
  return Math.floor((overlapEnd - overlapStart) / 1000);
}

/**
 * Totally-closed duration helper retained for callers that need raw session
 * length outside a window. Falls back to duration_seconds for malformed
 * timestamps, matching historic web helpers without letting that leak into
 * window overlap.
 */
export function getExecutionEvidenceSessionDurationSeconds(
  session: ExecutionEvidenceSessionRow,
  nowIso = new Date().toISOString(),
): number {
  const startMs = toMs(session.started_at);
  const endMs = session.ended_at ? toMs(session.ended_at) : toMs(nowIso);

  if (startMs !== null && endMs !== null && endMs >= startMs) {
    return Math.floor((endMs - startMs) / 1000);
  }

  return typeof session.duration_seconds === "number" ? Math.max(0, session.duration_seconds) : 0;
}

function compareSessionsDeterministic(
  a: ExecutionEvidenceSessionRow,
  b: ExecutionEvidenceSessionRow,
): number {
  const aMs = toMs(a.started_at);
  const bMs = toMs(b.started_at);
  const aVal = aMs === null ? Number.MAX_SAFE_INTEGER : aMs;
  const bVal = bMs === null ? Number.MAX_SAFE_INTEGER : bMs;
  if (aVal !== bVal) return aVal - bVal;
  const aTask = a.task_id ?? "";
  const bTask = b.task_id ?? "";
  const taskCmp = aTask.localeCompare(bTask);
  if (taskCmp !== 0) return taskCmp;
  const aId = (a.id as string | undefined) ?? "";
  const bId = (b.id as string | undefined) ?? "";
  return aId.localeCompare(bId);
}

function addBucket(
  buckets: Map<string, ExecutionEvidenceTimeBucket>,
  id: string | null | undefined,
  label: string | null | undefined,
  trackedSeconds: number,
): void {
  if (!id || !label || trackedSeconds <= 0) return;
  const existing = buckets.get(id);
  buckets.set(id, {
    id,
    label,
    trackedSeconds: (existing?.trackedSeconds ?? 0) + trackedSeconds,
    sessionCount: (existing?.sessionCount ?? 0) + 1,
  });
}

function evaluateQuality(input: {
  windowMalformed: boolean;
  malformedCount: number;
  openIncludedCount: number;
  sessionCount: number;
  totalTrackedSeconds: number;
}): ExecutionEvidenceQuality {
  const reasons: string[] = [];
  let quality: EvidenceQuality;

  if (input.windowMalformed) {
    reasons.push("malformed window");
  }
  if (input.malformedCount > 0) {
    reasons.push(`malformed sessions: ${input.malformedCount}`);
  }
  if (input.openIncludedCount > 0) {
    reasons.push(`open sessions included: ${input.openIncludedCount}`);
  }
  if (input.sessionCount === 0) {
    reasons.push("no contributing sessions");
  }

  if (input.windowMalformed || input.malformedCount > 0) {
    quality = "suspect";
  } else if (input.openIncludedCount > 0) {
    quality = "provisional";
  } else if (input.sessionCount === 0) {
    quality = "insufficient";
  } else {
    quality = "sufficient";
  }

  return {
    quality,
    reasons,
    hasOpenSessions: input.openIncludedCount > 0,
    openSessionCount: input.openIncludedCount,
    malformedCount: input.malformedCount,
    sessionCount: input.sessionCount,
    totalTrackedSeconds: input.totalTrackedSeconds,
  };
}

// ---------------------------------------------------------------------------
// Day splitting — UTC calendar days, avoids double-count across midnight.
// ---------------------------------------------------------------------------

function toUtcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function splitIntervalByUtcDay(
  intervalStartMs: number,
  intervalEndMs: number,
): Array<{ dayKey: string; seconds: number }> {
  const parts: Array<{ dayKey: string; seconds: number }> = [];
  let cursor = intervalStartMs;
  while (cursor < intervalEndMs) {
    const dayStart = new Date(toUtcDayKey(cursor) + "T00:00:00.000Z").getTime();
    const nextDayStart = dayStart + 86_400_000;
    const segmentEnd = Math.min(intervalEndMs, nextDayStart);
    const seconds = Math.floor((segmentEnd - cursor) / 1000);
    if (seconds > 0) {
      parts.push({ dayKey: toUtcDayKey(cursor), seconds });
    }
    cursor = segmentEnd;
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Main aggregation — owner-scoped and bounded.
// ---------------------------------------------------------------------------

export function calculateExecutionEvidenceForWindow(
  sessions: ExecutionEvidenceSessionRow[],
  window: ExecutionEvidenceWindow,
  options: ExecutionEvidenceOptions = {},
): ExecutionEvidenceSummary {
  const nowIso = resolveNowIso(options.nowIso);
  const includeOpen = options.includeOpenSessions === true;

  const windowMalformed = isMalformedWindow(window);
  const windowStartMs = toMs(window.startIso);
  const windowEndMs = toMs(window.endIso);

  const trackedSecondsByTask = new Map<string, number>();
  const trackedSecondsByProject = new Map<string, number>();
  const trackedSecondsByGoal = new Map<string, number>();
  const trackedSecondsByDay = new Map<string, number>();

  const taskBuckets = new Map<string, ExecutionEvidenceTimeBucket>();
  const projectBuckets = new Map<string, ExecutionEvidenceTimeBucket>();
  const goalBuckets = new Map<string, ExecutionEvidenceTimeBucket>();
  const dayBuckets = new Map<string, ExecutionEvidenceTimeBucket>();

  const touchedProjectNames = new Set<string>();
  const touchedGoalTitles = new Set<string>();

  let totalTrackedSeconds = 0;
  let sessionCount = 0;
  let malformedCount = 0;
  let openIncludedCount = 0;

  type Contributing = {
    session: ExecutionEvidenceSessionRow;
    trackedSeconds: number;
    overlapStartMs: number;
    overlapEndMs: number;
  };
  const contributing: Contributing[] = [];

  for (const session of sessions) {
    if (isMalformedSession(session)) {
      malformedCount += 1;
    }

    const trackedSeconds = getExecutionEvidenceSessionOverlapSeconds(session, window, {
      nowIso,
      includeOpenSessions: includeOpen,
    });

    if (trackedSeconds <= 0) {
      continue;
    }

    const isOpen = session.ended_at === null || session.ended_at === undefined;
    if (isOpen && includeOpen) {
      openIncludedCount += 1;
    }

    // For day splitting we need the actual overlap interval.
    const sessionStartMs = toMs(session.started_at)!;
    const sessionEndMs = session.ended_at ? toMs(session.ended_at)! : toMs(nowIso)!;
    const overlapStartMs = Math.max(sessionStartMs, windowStartMs ?? sessionStartMs);
    const overlapEndMs = Math.min(sessionEndMs, windowEndMs ?? sessionEndMs);

    totalTrackedSeconds += trackedSeconds;
    sessionCount += 1;
    contributing.push({ session, trackedSeconds, overlapStartMs, overlapEndMs });

    const task = session.tasks;
    const taskId = getTaskId(session);

    trackedSecondsByTask.set(
      session.task_id,
      (trackedSecondsByTask.get(session.task_id) ?? 0) + trackedSeconds,
    );
    addBucket(taskBuckets, taskId, task?.title ?? "Untitled task", trackedSeconds);

    // Project bucket — canonical key is project id, label is project name.
    if (task?.projects?.name) {
      touchedProjectNames.add(task.projects.name);
      const projectId = (task.projects.id ?? task.project_id) as string | null | undefined;
      addBucket(projectBuckets, projectId, task.projects.name, trackedSeconds);
      if (projectId) {
        trackedSecondsByProject.set(
          projectId,
          (trackedSecondsByProject.get(projectId) ?? 0) + trackedSeconds,
        );
      }
    }

    // Goal bucket
    if (task?.goals?.title) {
      touchedGoalTitles.add(task.goals.title);
      const goalId = (task.goals.id ?? task.goal_id) as string | null | undefined;
      if (goalId) {
        trackedSecondsByGoal.set(
          goalId,
          (trackedSecondsByGoal.get(goalId) ?? 0) + trackedSeconds,
        );
      }
      // Even when goal has no stable id, still produce a bucket for display.
      // Use goal title as fallback key for the bucket map only.
      const goalBucketId = goalId ?? `goal:${task.goals.title}`;
      // We keep goalBuckets keyed by that fallback; quality/aggregation maps
      // remain id-scoped to avoid colliding unrelated goals with same title.
      addBucket(goalBuckets, goalBucketId, task.goals.title, trackedSeconds);
    }

    // Day buckets: split this session's overlap across UTC calendar days.
    const dayParts = splitIntervalByUtcDay(overlapStartMs, overlapEndMs);
    for (const part of dayParts) {
      trackedSecondsByDay.set(
        part.dayKey,
        (trackedSecondsByDay.get(part.dayKey) ?? 0) + part.seconds,
      );
      addBucket(dayBuckets, part.dayKey, part.dayKey, part.seconds);
    }
  }

  // Deterministic ordered transitions — only contributing sessions, stable sort.
  const sorted = [...contributing].sort((a, b) =>
    compareSessionsDeterministic(a.session, b.session),
  );

  const transitions: OrderedSessionTransition[] = sorted.map((entry, idx) => {
    const s = entry.session;
    const t = s.tasks;
    return {
      index: idx,
      taskId: s.task_id,
      startedAt: s.started_at,
      endedAt: s.ended_at,
      projectId: (t?.projects?.id ?? t?.project_id ?? null) as string | null,
      goalId: (t?.goals?.id ?? t?.goal_id ?? null) as string | null,
      trackedSeconds: entry.trackedSeconds,
      sessionId: (s.id as string | undefined) ?? null,
    };
  });

  const quality = evaluateQuality({
    windowMalformed,
    malformedCount,
    openIncludedCount,
    sessionCount,
    totalTrackedSeconds,
  });

  return {
    window,
    totalTrackedSeconds,
    trackedSecondsByTask,
    trackedSecondsByProject,
    trackedSecondsByGoal,
    trackedSecondsByDay,
    taskTimeBuckets: Array.from(taskBuckets.values()),
    projectTimeBuckets: Array.from(projectBuckets.values()),
    goalTimeBuckets: Array.from(goalBuckets.values()),
    dayTimeBuckets: Array.from(dayBuckets.values()),
    touchedProjectNames: Array.from(touchedProjectNames),
    touchedGoalTitles: Array.from(touchedGoalTitles),
    sessionCount,
    openSessionCount: openIncludedCount,
    malformedCount,
    quality,
    transitions,
  };
}

// Legacy helper preserved for callers that sum raw durations without a window.
export function calculateTotalTrackedSeconds(
  sessions: ExecutionEvidenceSessionRow[],
  nowIso = new Date().toISOString(),
): number {
  return sessions.reduce<number>(
    (total, session) => total + getExecutionEvidenceSessionDurationSeconds(session, nowIso),
    0,
  );
}

// ---------------------------------------------------------------------------
// Ordered transitions helper exposed independently.
// ---------------------------------------------------------------------------

export function getOrderedSessionTransitions(
  sessions: ExecutionEvidenceSessionRow[],
  window: ExecutionEvidenceWindow,
  options: ExecutionEvidenceOptions = {},
): OrderedSessionTransition[] {
  return calculateExecutionEvidenceForWindow(sessions, window, options).transitions;
}

// ---------------------------------------------------------------------------
// Repository port — data-access implements, application owns the contract.
// ---------------------------------------------------------------------------

import type { AuthenticatedActor } from "../auth/actor";
import type { RepositoryResult } from "./result";

export interface ExecutionEvidenceRepository {
  listSessionsForWindow(
    actor: AuthenticatedActor,
    window: ExecutionEvidenceWindow,
    options?: Readonly<{ limit?: number }>,
  ): Promise<RepositoryResult<ExecutionEvidenceSessionRow[]>>;
}
