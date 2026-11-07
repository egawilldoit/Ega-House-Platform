/**
 * Work targets progress — weekly work and job-search subset.
 *
 * Owner: @ega/application (pure, framework-independent).
 *
 * ## Week window
 * The owner-local week is Monday 00:00 through the following Monday 00:00
 * (half-open) in the supplied IANA timezone. It is clipped to `nowIso`, so
 * future days carry their target but no actual minutes.
 *
 * ## Open-session policy
 * `includeOpenSessions` defaults to `false`. An open session (`ended_at` null)
 * contributes nothing unless explicitly included; when included its effective
 * end is `nowIso` and quality becomes `provisional`. This matches the shared
 * execution-evidence policy used by the rest of analytics.
 *
 * ## Job search is a subset
 * Job-search seconds are accumulated only for sessions whose stable reference
 * id matches exactly (`kind: "task"` or `kind: "project"`). Titles are never
 * compared. Those seconds are already part of the work total; they are never
 * added to it a second time.
 *
 * ## No reference
 * A configured job-search target without a reference is reported as
 * `jobSearchConfigured: false` with zero actual search minutes. Callers must
 * render "Not configured" instead of a fictitious 0/target completion.
 * Weekend targets of 0 need no reference.
 */

import { DAYS, isJobSearchReference, type Day, type JobSearchReference, type PersonalOperations } from "@ega/domain";
import {
  addDaysToIsoDate,
  getCurrentWeekWindow,
  getLocalDateInTimezone,
  splitIntervalByLocalDay,
} from "@ega/domain/time-context";

import {
  calculateExecutionEvidenceForWindow,
  type EvidenceQuality,
  type ExecutionEvidenceSessionRow,
} from "../shared/execution-evidence";

export type WorkTargetProgressInput = Readonly<{
  sessions: ExecutionEvidenceSessionRow[];
  personalOperations: PersonalOperations;
  timezone: string;
  nowIso: string;
  /** Default false; open sessions are excluded unless the caller opts in. */
  includeOpenSessions?: boolean;
}>;

export type WorkTargetDay = Readonly<{
  date: string;
  dayOfWeek: Day;
  actualWorkMinutes: number;
  targetWorkMinutes: number;
  actualJobSearchMinutes: number;
  targetJobSearchMinutes: number;
  jobSearchConfigured: boolean;
  isFuture: boolean;
}>;

export type WorkTargetWeekTotals = Readonly<{
  /** Actual minutes week-to-date (closed days plus today). */
  actualWorkMinutes: number;
  actualJobSearchMinutes: number;
  /** Full-week target, the sum of the seven daily targets. */
  targetWorkMinutes: number;
  targetJobSearchMinutes: number;
  /** Targets for the elapsed days (Monday through today inclusive). */
  weekToDateTargetWorkMinutes: number;
  weekToDateTargetJobSearchMinutes: number;
}>;

export type WorkTargetProgress = Readonly<{
  weekStart: string;
  weekEnd: string;
  weekStartUtcIso: string;
  weekEndExclusiveUtcIso: string;
  timezone: string;
  todayDate: string;
  days: WorkTargetDay[];
  today: WorkTargetDay;
  week: WorkTargetWeekTotals;
  reference: JobSearchReference | null;
  paused: boolean;
  includeOpenSessions: boolean;
  quality: EvidenceQuality;
  /** False when a positive job-search target has no stable reference. */
  jobSearchConfigured: boolean;
}>;

function toMs(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function matchesReference(
  session: ExecutionEvidenceSessionRow,
  reference: JobSearchReference,
): boolean {
  if (reference.kind === "task") {
    return session.task_id === reference.id || session.tasks?.id === reference.id;
  }
  return (
    session.tasks?.projects?.id === reference.id ||
    session.tasks?.project_id === reference.id
  );
}

export function calculateWorkTargetProgress(
  input: WorkTargetProgressInput,
): WorkTargetProgress {
  const nowMs = toMs(input.nowIso);
  if (nowMs === null) {
    throw new Error("Invalid now timestamp for work targets.");
  }

  const week = getCurrentWeekWindow(input.timezone, new Date(nowMs));
  const timezone = week.timezone;
  const weekStartMs = Date.parse(week.weekStartUtcIso);
  const weekEndExclusiveMs = Date.parse(week.weekEndExclusiveUtcIso);
  const clippedNowMs = Math.min(nowMs, weekEndExclusiveMs);
  const todayDate = getLocalDateInTimezone(new Date(nowMs), timezone);
  const includeOpenSessions = input.includeOpenSessions === true;

  const reference =
    input.personalOperations.jobSearchReference &&
    isJobSearchReference(input.personalOperations.jobSearchReference)
      ? input.personalOperations.jobSearchReference
      : null;

  // Work totals come from the canonical execution-evidence aggregation, which
  // owns malformed-row handling, open-session policy and local-day bucketing.
  const evidence =
    clippedNowMs > weekStartMs
      ? calculateExecutionEvidenceForWindow(
          input.sessions,
          { startIso: week.weekStartUtcIso, endIso: new Date(clippedNowMs).toISOString() },
          { nowIso: input.nowIso, includeOpenSessions, timezone },
        )
      : null;
  const quality: EvidenceQuality = evidence?.quality.quality ?? "insufficient";

  const searchSecondsByDay = new Map<string, number>();
  if (reference) {
    for (const session of input.sessions) {
      const sessionStartMs = toMs(session.started_at);
      if (sessionStartMs === null) continue;

      const isOpen = session.ended_at === null || session.ended_at === undefined;
      if (isOpen && !includeOpenSessions) continue;
      const sessionEndMs = isOpen ? nowMs : session.ended_at ? toMs(session.ended_at) : null;
      if (sessionEndMs === null || sessionEndMs < sessionStartMs) continue;

      const overlapStartMs = Math.max(sessionStartMs, weekStartMs);
      const overlapEndMs = Math.min(sessionEndMs, clippedNowMs);
      if (overlapEndMs <= overlapStartMs) continue;
      if (!matchesReference(session, reference)) continue;

      for (const part of splitIntervalByLocalDay(timezone, overlapStartMs, overlapEndMs)) {
        searchSecondsByDay.set(
          part.dayKey,
          (searchSecondsByDay.get(part.dayKey) ?? 0) + part.seconds,
        );
      }
    }
  }

  const workSecondsByDay = evidence?.trackedSecondsByDay ?? new Map<string, number>();
  const days: WorkTargetDay[] = [];
  for (let index = 0; index < 7; index += 1) {
    const date = addDaysToIsoDate(week.weekStart, index);
    const dayOfWeek = DAYS[index] as Day;
    const target = input.personalOperations.targets[dayOfWeek];
    const targetJobSearchMinutes = target.jobSearch;
    const isFuture = date > todayDate;
    days.push({
      date,
      dayOfWeek,
      actualWorkMinutes: Math.floor((workSecondsByDay.get(date) ?? 0) / 60),
      targetWorkMinutes: target.work,
      actualJobSearchMinutes: Math.floor((searchSecondsByDay.get(date) ?? 0) / 60),
      targetJobSearchMinutes,
      // A zero search target needs no reference (weekends by default).
      jobSearchConfigured: reference !== null || targetJobSearchMinutes === 0,
      isFuture,
    });
  }

  const today = days.find((day) => day.date === todayDate);
  if (!today) throw new Error("Unable to resolve today inside the current week.");

  const targetWorkMinutes = days.reduce((sum, day) => sum + day.targetWorkMinutes, 0);
  const targetJobSearchMinutes = days.reduce(
    (sum, day) => sum + day.targetJobSearchMinutes,
    0,
  );
  const elapsedDays = days.filter((day) => !day.isFuture);

  return {
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    weekStartUtcIso: week.weekStartUtcIso,
    weekEndExclusiveUtcIso: week.weekEndExclusiveUtcIso,
    timezone,
    todayDate,
    days,
    today,
    week: {
      actualWorkMinutes: days.reduce((sum, day) => sum + day.actualWorkMinutes, 0),
      actualJobSearchMinutes: days.reduce(
        (sum, day) => sum + day.actualJobSearchMinutes,
        0,
      ),
      targetWorkMinutes,
      targetJobSearchMinutes,
      weekToDateTargetWorkMinutes: elapsedDays.reduce(
        (sum, day) => sum + day.targetWorkMinutes,
        0,
      ),
      weekToDateTargetJobSearchMinutes: elapsedDays.reduce(
        (sum, day) => sum + day.targetJobSearchMinutes,
        0,
      ),
    },
    reference,
    paused: input.personalOperations.paused,
    includeOpenSessions,
    quality,
    jobSearchConfigured: reference !== null || targetJobSearchMinutes === 0,
  };
}
