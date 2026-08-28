import { getWeekWindow, isValidIANATimeZone } from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import {
  applicationFailure,
  applicationSuccess,
  type ApplicationResult,
} from "../shared/result";
import {
  calculateExecutionEvidenceForWindow,
  getExecutionEvidenceSessionOverlapSeconds,
  type ExecutionEvidenceWindow,
  type ExecutionEvidenceSessionRow,
  type ExecutionEvidenceRepository,
} from "../shared/execution-evidence";
import type { TimeContextRepository } from "../shared/time-context";

import { generateWeeklyReviewDraft, type WeeklyReviewDraft, type WeeklyReviewTaskActivity } from "./draft";
import type {
  WeeklyReviewRepository,
  WeeklyReviewTaskRepository,
  WeeklyReviewTaskActivityRow,
} from "./ports";
import {
  buildWeeklyReviewComparison,
  getPreviousExecutionWindow,
  getPreviousWeekWindow,
  type WeeklyReviewComparison,
} from "./comparison";

// ---------------------------------------------------------------------------
// Types exposed by the read model (owner-scoped, canonical timezone)
// ---------------------------------------------------------------------------

export type WeeklyReviewWeekWindow = Readonly<{
  weekOf: string;
  weekStart: string;
  weekEnd: string;
  weekStartUtc: string;
  weekEndExclusiveUtc: string;
  timezone: string;
  requestedTimezone: string | null;
  fallback: "none" | "invalid_timezone" | "missing_timezone";
}>;

export type WeeklyReviewSavedReview = Readonly<{
  id: string;
  weekStart: string;
  weekEnd: string;
  summary: string | null;
  wins: string | null;
  blockers: string | null;
  nextSteps: string | null;
  createdAt: string;
  updatedAt: string | null;
  officialEmailStatus: string | null;
  officialEmailSentAt: string | null;
}>;

export type WeeklyReviewStats = Readonly<{
  tasksCreated: number;
  sessionsLogged: number;
  trackedSeconds: number;
  goalsTouched: number;
  goalStatusCounts: Array<{ status: string; count: number }>;
  blockedTasks: Array<{ id: string; title: string; blockedReason: string | null; updatedAt: string }>;
}>;

export type WeeklyReviewMostTrackedInsight = Readonly<{
  id: string;
  label: string;
  href: string | null;
  trackedSeconds: number;
  trackedLabel: string;
  sessionCount: number;
  detail: string;
}>;

export type WeeklyReviewMostTracked = Readonly<{
  tasks: WeeklyReviewMostTrackedInsight[];
  projects: WeeklyReviewMostTrackedInsight[];
  goals: WeeklyReviewMostTrackedInsight[];
}>;

export type WeeklyReviewReadModel = Readonly<{
  window: WeeklyReviewWeekWindow;
  savedReview: WeeklyReviewSavedReview | null;
  pastReviews: WeeklyReviewSavedReview[];
  stats: WeeklyReviewStats;
  evidence: ReturnType<typeof calculateExecutionEvidenceForWindow>;
  mostTracked: WeeklyReviewMostTracked;
  generatedDraft: WeeklyReviewDraft;
  comparison: WeeklyReviewComparison;
}>;

// ---------------------------------------------------------------------------
// Helpers: timezone resolution (explicit input not now-dependent)
// ---------------------------------------------------------------------------

function normalizeWeekOf(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

async function resolveEffectiveTimezone(
  actor: AuthenticatedActor,
  timeContextRepo: TimeContextRepository,
  requestedTimezone: unknown,
): Promise<
  | { ok: true; timezone: string; requestedTimezone: string | null; fallback: "none" | "invalid_timezone" | "missing_timezone" }
  | { ok: false; errorMessage: string }
> {
  const rawRequested = typeof requestedTimezone === "string" ? requestedTimezone.trim() : "";
  if (rawRequested) {
    if (isValidIANATimeZone(rawRequested)) {
      return { ok: true, timezone: rawRequested, requestedTimezone: rawRequested, fallback: "none" };
    }
    return {
      ok: true,
      timezone: "UTC",
      requestedTimezone: rawRequested,
      fallback: "invalid_timezone",
    };
  }

  const storedResult = await timeContextRepo.getTimezone(actor);
  if (!storedResult.ok) {
    return { ok: false, errorMessage: "Unable to load time context right now." };
  }
  const stored = storedResult.value ? String(storedResult.value).trim() : null;
  if (stored && isValidIANATimeZone(stored)) {
    return { ok: true, timezone: stored, requestedTimezone: null, fallback: "none" };
  }
  if (stored) {
    return { ok: true, timezone: "UTC", requestedTimezone: stored, fallback: "invalid_timezone" };
  }
  return { ok: true, timezone: "UTC", requestedTimezone: null, fallback: "missing_timezone" };
}

function formatCompactDurationLabel(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${safeSeconds}s`;
}

function toTaskHref(taskId: string, projectSlug: string | null | undefined): string | null {
  if (!projectSlug) return null;
  return `/tasks/projects/${projectSlug}#task-${taskId}`;
}
function toProjectHref(projectSlug: string | null | undefined): string | null {
  if (!projectSlug) return null;
  return `/tasks/projects/${projectSlug}`;
}
function toGoalHref(goalId: string | null | undefined): string | null {
  if (!goalId) return null;
  return `/goals?view=all&goal=${goalId}#goal-${goalId}`;
}

// Build mostTracked from sessions using canonical overlap (exclude open by default)
function buildMostTracked(
  sessions: ExecutionEvidenceSessionRow[],
  window: ExecutionEvidenceWindow,
  nowIso: string,
  limit = 5,
): WeeklyReviewMostTracked {
  type Bucket = Omit<WeeklyReviewMostTrackedInsight, "trackedLabel">;
  const taskBuckets = new Map<string, Bucket>();
  const projectBuckets = new Map<string, Bucket>();
  const goalBuckets = new Map<string, Bucket>();

  for (const session of sessions) {
    const trackedSeconds = getExecutionEvidenceSessionOverlapSeconds(session, window, {
      nowIso,
      includeOpenSessions: false,
    });
    if (trackedSeconds <= 0 || !session.tasks?.id) continue;
    const task = session.tasks as {
      id: string;
      title: string;
      projects?: { id?: string | null; name?: string | null } | null;
      goals?: { id?: string | null; title?: string | null } | null;
    } & Record<string, unknown>;

    const project = task.projects as { id?: string; name?: string; slug?: string } | null | undefined;
    const goal = task.goals as { id?: string; title?: string } | null | undefined;

    const taskBucket = taskBuckets.get(task.id) as unknown as Bucket | undefined;
    taskBuckets.set(task.id, {
      id: task.id,
      label: task.title,
      href: toTaskHref(task.id, (project as unknown as { slug?: string })?.slug),
      trackedSeconds: (taskBucket?.trackedSeconds ?? 0) + trackedSeconds,
      sessionCount: (taskBucket?.sessionCount ?? 0) + 1,
      detail: [project?.name, goal?.title].filter(Boolean).join(" • ") || "Tracked task",
    });

    if (project?.id) {
      const existing = projectBuckets.get(project.id);
      projectBuckets.set(project.id, {
        id: project.id,
        label: project.name ?? "Untitled project",
        href: toProjectHref((project as unknown as { slug?: string })?.slug),
        trackedSeconds: (existing?.trackedSeconds ?? 0) + trackedSeconds,
        sessionCount: (existing?.sessionCount ?? 0) + 1,
        detail: `${task.title}${goal?.title ? ` • ${goal.title}` : ""}`,
      });
    }

    if (goal?.id) {
      const existing = goalBuckets.get(goal.id);
      goalBuckets.set(goal.id, {
        id: goal.id,
        label: goal.title ?? "Untitled goal",
        href: toGoalHref(goal.id),
        trackedSeconds: (existing?.trackedSeconds ?? 0) + trackedSeconds,
        sessionCount: (existing?.sessionCount ?? 0) + 1,
        detail: (project?.name as string | undefined) ?? task.title,
      });
    }
  }

  const sortAndFormat = (rows: Iterable<Bucket>): WeeklyReviewMostTrackedInsight[] => {
    return Array.from(rows)
      .sort(
        (left, right) =>
          right.trackedSeconds - left.trackedSeconds ||
          right.sessionCount - left.sessionCount ||
          left.label.localeCompare(right.label),
      )
      .slice(0, limit)
      .map((row) => ({
        ...row,
        trackedLabel: formatCompactDurationLabel(row.trackedSeconds),
      }));
  };

  return {
    tasks: sortAndFormat(taskBuckets.values()),
    projects: sortAndFormat(projectBuckets.values()),
    goals: sortAndFormat(goalBuckets.values()),
  };
}

function mapActivity(
  row: WeeklyReviewTaskActivityRow,
  trackedSecondsByTask: Map<string, number>,
): WeeklyReviewTaskActivity {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    blockedReason: row.blockedReason,
    estimateMinutes: row.estimateMinutes,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt,
    projectName: row.projectName,
    goalTitle: row.goalTitle,
    trackedSeconds: trackedSecondsByTask.get(row.id) ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Public use case
// ---------------------------------------------------------------------------

export type WeeklyReviewReadModelDeps = Readonly<{
  timeContext: TimeContextRepository;
  weeklyReview: WeeklyReviewRepository;
  weeklyTasks: WeeklyReviewTaskRepository;
  executionEvidence: ExecutionEvidenceRepository;
}>;

export async function getWeeklyReviewReadModel(
  actor: AuthenticatedActor,
  deps: WeeklyReviewReadModelDeps,
  input: Readonly<{ weekOf?: unknown; timezone?: unknown; now?: Date }>,
): Promise<ApplicationResult<WeeklyReviewReadModel>> {
  const providedWeekOfRaw = typeof input.weekOf === "string" ? String(input.weekOf).trim() : input.weekOf !== undefined && input.weekOf !== null ? String(input.weekOf).trim() : "";
  const rawWeekOf = normalizeWeekOf(input.weekOf);
  if (providedWeekOfRaw && !rawWeekOf) {
    return applicationFailure("Week date is invalid. Expected YYYY-MM-DD.");
  }
  // If weekOf not provided, derive from now via timezone-aware local date.
  // Historical queries must provide explicit weekOf; this fallback is for
  // current-week default (today) and is still timezone-aware, not UTC-only.
  let weekOf: string = rawWeekOf ?? "";
  if (rawWeekOf) {
    weekOf = rawWeekOf;
  } else if (!providedWeekOfRaw) {
    const now = input.now ?? new Date();
    if (Number.isNaN(now.getTime())) {
      return applicationFailure("Week date is invalid.");
    }
    // Use a lightweight timezone-aware local date derivation without reusing
    // resolveTimeContext's now-dependent dayWindow; we need explicit weekOf first.
    // Resolve timezone first, then derive local date.
    const tzResolved = await resolveEffectiveTimezone(actor, deps.timeContext, input.timezone);
    if (!tzResolved.ok) return applicationFailure(tzResolved.errorMessage);
    try {
      const { getLocalDateInTimezone } = await import("@ega/domain");
      const localDate = getLocalDateInTimezone(now, tzResolved.timezone);
      weekOf = localDate;
      // proceed with tzResolved's timezone for window below; avoid double resolve
      const weekWindowRaw = getWeekWindow(tzResolved.timezone, weekOf);
      const window: WeeklyReviewWeekWindow = {
        weekOf,
        weekStart: weekWindowRaw.weekStart,
        weekEnd: weekWindowRaw.weekEnd,
        weekStartUtc: weekWindowRaw.weekStartUtcIso,
        weekEndExclusiveUtc: weekWindowRaw.weekEndExclusiveUtcIso,
        timezone: tzResolved.timezone,
        requestedTimezone: tzResolved.requestedTimezone,
        fallback: tzResolved.fallback,
      };
      const execWindow: ExecutionEvidenceWindow = {
        startIso: window.weekStartUtc,
        endIso: window.weekEndExclusiveUtc,
      };
      return buildModel(actor, deps, window, execWindow, input.now);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to resolve week window.";
      return applicationFailure(message);
    }
  }

  // Explicit weekOf path: historical, not now-dependent
  const tzResolved = await resolveEffectiveTimezone(actor, deps.timeContext, input.timezone);
  if (!tzResolved.ok) return applicationFailure(tzResolved.errorMessage);

  let weekWindowRaw: ReturnType<typeof getWeekWindow>;
  try {
    weekWindowRaw = getWeekWindow(tzResolved.timezone, weekOf);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Week date is invalid.";
    if (message.includes("Invalid date")) return applicationFailure("Week date is invalid. Expected YYYY-MM-DD.");
    return applicationFailure(message);
  }

  const window: WeeklyReviewWeekWindow = {
    weekOf,
    weekStart: weekWindowRaw.weekStart,
    weekEnd: weekWindowRaw.weekEnd,
    weekStartUtc: weekWindowRaw.weekStartUtcIso,
    weekEndExclusiveUtc: weekWindowRaw.weekEndExclusiveUtcIso,
    timezone: tzResolved.timezone,
    requestedTimezone: tzResolved.requestedTimezone,
    fallback: tzResolved.fallback,
  };

  const execWindow: ExecutionEvidenceWindow = {
    startIso: window.weekStartUtc,
    endIso: window.weekEndExclusiveUtc,
  };

  return buildModel(actor, deps, window, execWindow, input.now);
}

async function buildModel(
  actor: AuthenticatedActor,
  deps: WeeklyReviewReadModelDeps,
  window: WeeklyReviewWeekWindow,
  execWindow: ExecutionEvidenceWindow,
  now?: Date,
): Promise<ApplicationResult<WeeklyReviewReadModel>> {
  const nowIso = (now ?? new Date()).toISOString();

  // Previous window is adjacent and uses identical boundary rules (same timezone)
  const previousWindow = getPreviousWeekWindow(window);
  const previousExecWindow = getPreviousExecutionWindow(previousWindow);

  const [
    savedReviewRes,
    pastReviewsRes,
    tasksCreatedRes,
    goalsTouchedRes,
    blockedTasksRes,
    sessionsRes,
    completedRes,
    carriedRes,
    blockedForDraftRes,
    previousRes,
    prevTasksCreatedRes,
    prevGoalsTouchedRes,
    prevSessionsRes,
    prevCompletedRes,
  ] = await Promise.all([
    deps.weeklyReview.getSavedReview(actor, window.weekStart, window.weekEnd),
    deps.weeklyReview.listPastReviews(actor, 100),
    deps.weeklyTasks.countTasksCreatedForWindow(actor, execWindow),
    deps.weeklyTasks.listGoalsTouchedForWindow(actor, execWindow),
    deps.weeklyTasks.listBlockedTasks(actor, 6),
    deps.executionEvidence.listSessionsForWindow(actor, execWindow, { limit: 2000 }),
    deps.weeklyTasks.listCompletedTasksForWindow(actor, execWindow, 80),
    deps.weeklyTasks.listCarriedTasksForWindow(actor, execWindow, 120),
    deps.weeklyTasks.listBlockedTasksForWindow(actor, execWindow, 80),
    deps.weeklyReview.getPreviousReview(actor, window.weekStart),
    deps.weeklyTasks.countTasksCreatedForWindow(actor, previousExecWindow),
    deps.weeklyTasks.listGoalsTouchedForWindow(actor, previousExecWindow),
    deps.executionEvidence.listSessionsForWindow(actor, previousExecWindow, { limit: 2000 }),
    deps.weeklyTasks.listCompletedTasksForWindow(actor, previousExecWindow, 80),
  ]);

  if (!savedReviewRes.ok) return applicationFailure("Unable to load review right now.");
  if (!pastReviewsRes.ok) return applicationFailure("Unable to load review history right now.");
  if (!tasksCreatedRes.ok) return applicationFailure("Unable to load weekly task stats.");
  if (!goalsTouchedRes.ok) return applicationFailure("Unable to load weekly goal stats.");
  if (!blockedTasksRes.ok) return applicationFailure("Unable to load blocked tasks.");
  if (!sessionsRes.ok) return applicationFailure("Unable to load execution evidence right now.");
  if (!completedRes.ok) return applicationFailure("Unable to load completed tasks.");
  if (!carriedRes.ok) return applicationFailure("Unable to load carried tasks.");
  if (!blockedForDraftRes.ok) return applicationFailure("Unable to load blocked tasks.");
  if (!previousRes.ok) return applicationFailure("Unable to load previous review.");
  if (!prevTasksCreatedRes.ok) return applicationFailure("Unable to load weekly task stats.");
  if (!prevGoalsTouchedRes.ok) return applicationFailure("Unable to load weekly goal stats.");
  if (!prevSessionsRes.ok) return applicationFailure("Unable to load execution evidence right now.");
  if (!prevCompletedRes.ok) return applicationFailure("Unable to load completed tasks.");

  const evidence = calculateExecutionEvidenceForWindow(sessionsRes.value, execWindow, {
    nowIso,
    includeOpenSessions: false,
  });
  const previousEvidence = calculateExecutionEvidenceForWindow(prevSessionsRes.value, previousExecWindow, {
    nowIso,
    includeOpenSessions: false,
  });

  // Most tracked derived from same sessions (canonical)
  const mostTracked = buildMostTracked(sessionsRes.value, execWindow, nowIso, 5);

  // Stats
  const goalStatusCounts = Array.from(
    (goalsTouchedRes.value ?? []).reduce<Map<string, number>>((counts, goal) => {
      const status = String((goal as { status?: string }).status ?? "unknown");
      counts.set(status, (counts.get(status) ?? 0) + 1);
      return counts;
    }, new Map()),
  )
    .map(([status, count]) => ({ status, count }))
    .sort((left, right) => right.count - left.count || left.status.localeCompare(right.status))
    .slice(0, 3);

  const stats: WeeklyReviewStats = {
    tasksCreated: tasksCreatedRes.value ?? 0,
    sessionsLogged: evidence.sessionCount,
    trackedSeconds: evidence.totalTrackedSeconds,
    goalsTouched: goalsTouchedRes.value.length ?? 0,
    goalStatusCounts,
    blockedTasks: (blockedTasksRes.value ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      blockedReason: t.blockedReason,
      updatedAt: t.updatedAt,
    })),
  };

  // Draft generation
  const touchedProjects = new Set<string>(evidence.touchedProjectNames);
  const touchedGoals = new Set<string>(evidence.touchedGoalTitles);

  // Add project/goal names from draft task sets and goals
  for (const row of [...completedRes.value, ...carriedRes.value, ...blockedForDraftRes.value]) {
    if (row.projectName) touchedProjects.add(row.projectName);
    if (row.goalTitle) touchedGoals.add(row.goalTitle);
  }
  for (const goal of goalsTouchedRes.value as Array<{ title?: string }>) {
    // goalsTouched currently only has status; but if title present, include
    if ((goal as { title?: string }).title) touchedGoals.add((goal as { title?: string }).title as string);
  }

  const previousReview = previousRes.value
    ? {
        weekStart: previousRes.value.weekStart,
        weekEnd: previousRes.value.weekEnd,
        summary: previousRes.value.summary,
        nextSteps: previousRes.value.nextSteps,
      }
    : null;

  const generatedDraft = generateWeeklyReviewDraft({
    weekStart: window.weekStart,
    weekEnd: window.weekEnd,
    completedTasks: completedRes.value.map((r) => mapActivity(r, evidence.trackedSecondsByTask)),
    carriedTasks: carriedRes.value.map((r) => mapActivity(r, evidence.trackedSecondsByTask)),
    blockedTasks: blockedForDraftRes.value.map((r) => mapActivity(r, evidence.trackedSecondsByTask)),
    projectTime: evidence.projectTimeBuckets.map((b) => ({
      id: b.id,
      label: b.label,
      trackedSeconds: b.trackedSeconds,
      sessionCount: b.sessionCount,
    })),
    taskTime: evidence.taskTimeBuckets.map((b) => ({
      id: b.id,
      label: b.label,
      trackedSeconds: b.trackedSeconds,
      sessionCount: b.sessionCount,
    })),
    touchedProjects: Array.from(touchedProjects),
    touchedGoals: Array.from(touchedGoals),
    previousReview,
  });

  const savedReview: WeeklyReviewSavedReview | null = savedReviewRes.value
    ? {
        id: savedReviewRes.value.id,
        weekStart: savedReviewRes.value.weekStart,
        weekEnd: savedReviewRes.value.weekEnd,
        summary: savedReviewRes.value.summary,
        wins: savedReviewRes.value.wins,
        blockers: savedReviewRes.value.blockers,
        nextSteps: savedReviewRes.value.nextSteps,
        createdAt: savedReviewRes.value.createdAt,
        updatedAt: savedReviewRes.value.updatedAt,
        officialEmailStatus: savedReviewRes.value.officialEmailStatus,
        officialEmailSentAt: savedReviewRes.value.officialEmailSentAt,
      }
    : null;

  const pastReviews: WeeklyReviewSavedReview[] = (pastReviewsRes.value ?? []).map((row) => ({
    id: row.id,
    weekStart: row.weekStart,
    weekEnd: row.weekEnd,
    summary: row.summary,
    wins: row.wins,
    blockers: row.blockers,
    nextSteps: row.nextSteps,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    officialEmailStatus: row.officialEmailStatus,
    officialEmailSentAt: row.officialEmailSentAt,
  }));

  const comparison = buildWeeklyReviewComparison({
    currentWindow: window,
    previousWindow,
    current: {
      trackedSeconds: evidence.totalTrackedSeconds,
      sessionCount: evidence.sessionCount,
      tasksCreated: tasksCreatedRes.value ?? 0,
      goalsTouched: goalsTouchedRes.value.length ?? 0,
      completedTasks: completedRes.value.length,
    },
    previous: {
      trackedSeconds: previousEvidence.totalTrackedSeconds,
      sessionCount: previousEvidence.sessionCount,
      tasksCreated: prevTasksCreatedRes.value ?? 0,
      goalsTouched: prevGoalsTouchedRes.value.length ?? 0,
      completedTasks: prevCompletedRes.value.length,
    },
  });

  return applicationSuccess({
    window,
    savedReview,
    pastReviews,
    stats,
    evidence,
    mostTracked,
    generatedDraft,
    comparison,
  });
}

export function resolveWeeklyReviewFormDefaults(
  generatedDraft: WeeklyReviewDraft,
  savedReview: WeeklyReviewSavedReview | null,
  selectedWeekOf: string,
  useGeneratedDraft: boolean,
): { summary: string; wins: string; blockers: string; nextSteps: string; weekOf: string } {
  if (useGeneratedDraft || !savedReview) {
    return { ...generatedDraft, weekOf: selectedWeekOf };
  }
  return {
    summary: savedReview.summary?.trim() ?? "",
    wins: savedReview.wins?.trim() ?? "",
    blockers: savedReview.blockers?.trim() ?? "",
    nextSteps: savedReview.nextSteps?.trim() ?? "",
    weekOf: selectedWeekOf,
  };
}
