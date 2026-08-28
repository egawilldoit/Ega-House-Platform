import { getLocalDateInTimezone, getLocalDayWindow } from "@ega/domain";
import { isTaskCompletedStatus } from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import type { TodayReadPort, TodayActiveTimer } from "../today/ports";
import { buildTodayPlan, type TodayPlan, type TodayPlanTask } from "../today/plan";
import { resolveTimeContext, type TimeContextRepository } from "../shared/time-context";

// ---------------------------------------------------------------------------
// Operator snapshot types — canonical Daily Operator entry
// ---------------------------------------------------------------------------

export type OperatorTask = TodayPlanTask;

export type OperatorSignals = Readonly<{
  health: unknown | null;
  friction: unknown | null;
  inbox: unknown | null;
  weeklyObjective: unknown | null;
}>;

export type OperatorSnapshot = Readonly<{
  date: string;
  timezone: string;
  dayWindow: Readonly<{ startUtcIso: string; endUtcIso: string }>;
  timeContextId: string;
  sections: Readonly<{
    planned: OperatorTask[];
    inProgress: OperatorTask[];
    blocked: OperatorTask[];
    completed: OperatorTask[];
  }>;
  focus: Readonly<{
    startHere: OperatorTask | null;
    queue: OperatorTask[];
  }>;
  schedule: Readonly<{
    blocks: OperatorTask[];
    flexible: OperatorTask[];
  }>;
  plannedToday: OperatorTask[];
  suggestions: Readonly<{
    pinned: OperatorTask[];
    inProgress: OperatorTask[];
  }>;
  summary: TodayPlan["summary"];
  activeTimer: TodayActiveTimer | null;
  signals: OperatorSignals;
}>;

// Re-export base Today types for consumers that want the underlying plan
export type { TodayPlanTask, TodayActiveTimer };

const FOCUS_QUEUE_LIMIT = 7;
const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// Canonical schedule helpers — ported from web's today-plan-builder so the
// shared layer is the single owner. Web will delegate to these.

export function isValidScheduledTaskBlock(
  task: Pick<OperatorTask, "scheduledStartAt" | "scheduledEndAt">,
): boolean {
  if (!task.scheduledStartAt || !task.scheduledEndAt) return false;
  const start = new Date(task.scheduledStartAt);
  const end = new Date(task.scheduledEndAt);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) return false;
  return start < end;
}

export function isScheduledTaskForToday(
  task: Pick<OperatorTask, "scheduledStartAt" | "scheduledEndAt">,
  today: string,
  timezone: string = "UTC",
): boolean {
  if (!isValidScheduledTaskBlock(task) || !task.scheduledStartAt) return false;
  try {
    const localDate = getLocalDateInTimezone(new Date(task.scheduledStartAt), timezone);
    return localDate === today;
  } catch {
    return false;
  }
}

function sortScheduledBlocks(left: OperatorTask, right: OperatorTask): number {
  const leftStart = left.scheduledStartAt ?? "";
  const rightStart = right.scheduledStartAt ?? "";
  const startCompare = leftStart.localeCompare(rightStart);
  if (startCompare !== 0) return startCompare;
  const leftEnd = left.scheduledEndAt ?? "";
  const rightEnd = right.scheduledEndAt ?? "";
  const endCompare = leftEnd.localeCompare(rightEnd);
  if (endCompare !== 0) return endCompare;
  const titleCompare = left.title.localeCompare(right.title);
  if (titleCompare !== 0) return titleCompare;
  return left.id.localeCompare(right.id);
}

export function groupTodayTasksForTimeline(
  tasks: OperatorTask[],
  today: string,
  timezone: string = "UTC",
): { scheduledTasks: OperatorTask[]; flexibleTodayTasks: OperatorTask[] } {
  const scheduledTasks = tasks
    .filter((t) => isScheduledTaskForToday(t, today, timezone))
    .sort(sortScheduledBlocks);
  const scheduledIds = new Set(scheduledTasks.map((t) => t.id));
  const flexibleTodayTasks = tasks
    .filter((t) => t.isPlannedForToday && !scheduledIds.has(t.id) && !isValidScheduledTaskBlock(t))
    .sort(sortRecommendedTasks);
  return { scheduledTasks, flexibleTodayTasks };
}

function sortRecommendedTasks(left: OperatorTask, right: OperatorTask): number {
  if (left.hasActiveTimer !== right.hasActiveTimer) return left.hasActiveTimer ? -1 : 1;
  if (left.isPlannedForToday !== right.isPlannedForToday) return left.isPlannedForToday ? -1 : 1;
  const leftPriority = PRIORITY_RANK[left.priority] ?? PRIORITY_RANK.medium;
  const rightPriority = PRIORITY_RANK[right.priority] ?? PRIORITY_RANK.medium;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  if (left.focusRank !== null && right.focusRank !== null && left.focusRank !== right.focusRank) {
    return left.focusRank - right.focusRank;
  }
  if ((left.focusRank !== null) !== (right.focusRank !== null)) return left.focusRank !== null ? -1 : 1;
  if (left.dueDate && right.dueDate && left.dueDate !== right.dueDate) return left.dueDate.localeCompare(right.dueDate);
  if ((left.dueDate !== null) !== (right.dueDate !== null)) return left.dueDate !== null ? -1 : 1;
  return right.updatedAt.localeCompare(left.updatedAt);
}

function getUniqueTasksByRank(tasks: OperatorTask[]): OperatorTask[] {
  const byId = new Map<string, OperatorTask>();
  for (const task of [...tasks].sort(sortRecommendedTasks)) {
    if (!byId.has(task.id)) byId.set(task.id, task);
  }
  return [...byId.values()];
}

// Build operator snapshot from a TodayPlan — adds focus, schedule, plannedToday,
// and nullable signal slots. This is the canonical composition; callers that
// already have a TodayPlan can use this to avoid re-querying.

export type BuildOperatorSnapshotInput = Readonly<{
  plan: TodayPlan;
  timezone?: string;
  timeContextId?: string;
  dayWindow?: Readonly<{ startUtcIso: string; endUtcIso: string }>;
  signals?: Partial<OperatorSignals>;
}>;

export function buildOperatorSnapshot(input: BuildOperatorSnapshotInput): OperatorSnapshot {
  const plan = input.plan;
  const timezone = input.timezone ?? "UTC";
  const dayWindow = input.dayWindow ?? (() => {
    try {
      const w = getLocalDayWindow(timezone, plan.date);
      return { startUtcIso: w.startUtcIso, endUtcIso: w.endUtcIso };
    } catch {
      return { startUtcIso: new Date().toISOString(), endUtcIso: new Date().toISOString() };
    }
  })();
  const timeContextId = input.timeContextId ?? `${plan.date}::${timezone}::${dayWindow.startUtcIso}`;
  const allSelected: OperatorTask[] = [
    ...plan.sections.planned,
    ...plan.sections.inProgress,
    ...plan.sections.blocked,
    ...plan.sections.completed,
  ];

  // Focus queue: selected + suggestions, filtered to actionable, rank-sorted, capped
  const focusQueue = getUniqueTasksByRank([
    ...allSelected,
    ...plan.suggestions.pinned,
    ...plan.suggestions.inProgress,
  ])
    .filter((t) => !isTaskCompletedStatus(t.status) && t.status !== "blocked")
    .slice(0, FOCUS_QUEUE_LIMIT);

  const startHere = focusQueue[0] ?? null;

  const plannedToday = allSelected.filter((t) => t.isPlannedForToday).sort(sortRecommendedTasks);

  const { scheduledTasks, flexibleTodayTasks } = groupTodayTasksForTimeline(allSelected, plan.date, timezone);

  const signals: OperatorSignals = {
    health: input.signals?.health ?? null,
    friction: input.signals?.friction ?? null,
    inbox: input.signals?.inbox ?? null,
    weeklyObjective: input.signals?.weeklyObjective ?? null,
  };

  return {
    date: plan.date,
    timezone,
    dayWindow,
    timeContextId,
    sections: plan.sections,
    focus: {
      startHere,
      queue: focusQueue,
    },
    schedule: {
      blocks: scheduledTasks,
      flexible: flexibleTodayTasks,
    },
    plannedToday,
    suggestions: plan.suggestions,
    summary: plan.summary,
    activeTimer: plan.activeTimer,
    signals,
  };
}

// ---------------------------------------------------------------------------
// Application use case: getOperatorSnapshot
// ---------------------------------------------------------------------------

export type OperatorSignalProviders = Readonly<{
  health?: (actor: AuthenticatedActor, date: string) => Promise<unknown | null>;
  friction?: (actor: AuthenticatedActor, date: string) => Promise<unknown | null>;
  inbox?: (actor: AuthenticatedActor, date: string) => Promise<unknown | null>;
  weeklyObjective?: (actor: AuthenticatedActor, date: string) => Promise<unknown | null>;
}>;

export async function getOperatorSnapshot(
  actor: AuthenticatedActor,
  todayPort: TodayReadPort,
  timeContextRepoOrInput: TimeContextRepository | Readonly<{ date?: unknown; now?: Date; signals?: OperatorSignalProviders; requestedTimezone?: unknown; timezone?: unknown }> = {},
  maybeInput: Readonly<{ date?: unknown; now?: Date; signals?: OperatorSignalProviders; requestedTimezone?: unknown; timezone?: unknown }> = {},
): Promise<ApplicationResult<OperatorSnapshot>> {
  // Support both signatures: (actor, port, repo, input) and legacy (actor, port, input)
  let timeContextRepo: TimeContextRepository | null = null;
  let input: Readonly<{ date?: unknown; now?: Date; signals?: OperatorSignalProviders; requestedTimezone?: unknown; timezone?: unknown }> = {};
  if (
    timeContextRepoOrInput &&
    typeof (timeContextRepoOrInput as TimeContextRepository).getTimezone === "function"
  ) {
    timeContextRepo = timeContextRepoOrInput as TimeContextRepository;
    input = maybeInput;
  } else {
    input = (timeContextRepoOrInput as Readonly<{ date?: unknown; now?: Date; signals?: OperatorSignalProviders; requestedTimezone?: unknown; timezone?: unknown }>) ?? {};
  }

  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) return applicationFailure("Current time is invalid.");

  // Resolve canonical Time Context when repo is available, otherwise fallback to UTC-aware conversion
  let timezone: string;
  let localDate = "";
  let dayWindow: { startUtcIso: string; endUtcIso: string };
  let timeContextId = "";
  if (timeContextRepo) {
    const tzInput = (input.requestedTimezone ?? input.timezone) as unknown;
    const tcResult = await resolveTimeContext(actor, timeContextRepo, { requestedTimezone: tzInput, now });
    if (!tcResult.ok) return applicationFailure(tcResult.errorMessage);
    const tc = tcResult.data;
    timezone = tc.timezone;
    // If caller supplied explicit date, honor it for historical queries but still use resolved timezone to compute window
    const rawDate = typeof input.date === "string" ? String(input.date).trim() : "";
    if (rawDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return applicationFailure("Today date is invalid.");
      localDate = rawDate;
      try {
        const w = getLocalDayWindow(timezone, localDate);
        dayWindow = { startUtcIso: w.startUtcIso, endUtcIso: w.endUtcIso };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unable to resolve time window.";
        return applicationFailure(msg);
      }
    } else {
      localDate = tc.localDate;
      dayWindow = { startUtcIso: tc.dayWindow.startUtcIso, endUtcIso: tc.dayWindow.endUtcIso };
    }
    timeContextId = `${localDate}::${timezone}::${dayWindow.startUtcIso}`;
  } else {
    // Legacy fallback without repo: use UTC and getLocalDateInTimezone for now
    const rawDate = typeof input.date === "string" ? String(input.date).trim() : "";
    const requestedTzRaw = typeof (input.requestedTimezone ?? input.timezone) === "string" ? String(input.requestedTimezone ?? input.timezone).trim() : "";
    timezone = requestedTzRaw && (() => { try { new Intl.DateTimeFormat("en-US", { timeZone: requestedTzRaw }).format(now); return true; } catch { return false; } })() ? requestedTzRaw : "UTC";
    if (rawDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return applicationFailure("Today date is invalid.");
      localDate = rawDate;
    } else {
      try {
        localDate = getLocalDateInTimezone(now, timezone);
      } catch {
        return applicationFailure("Unable to resolve local date right now.");
      }
    }
    try {
      const w = getLocalDayWindow(timezone, localDate);
      dayWindow = { startUtcIso: w.startUtcIso, endUtcIso: w.endUtcIso };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unable to resolve time window.";
      return applicationFailure(msg);
    }
    timeContextId = `${localDate}::${timezone}::${dayWindow.startUtcIso}`;
  }

  const nowIso = now.toISOString();
  const windowStartIso = dayWindow.startUtcIso;

  const [selectedResult, pinnedResult, inProgressResult, timerResult] = await Promise.all([
    todayPort.listSelectedTasks(actor, { today: localDate }),
    todayPort.listPinnedSuggestions(actor, { limit: 80 }),
    todayPort.listInProgressSuggestions(actor, { limit: 80 }),
    todayPort.getTodayTimerSnapshot(actor, { nowIso, windowStartIso }),
  ]);

  if (!selectedResult.ok) return applicationFailure("Unable to load Today right now.");
  if (!pinnedResult.ok || !inProgressResult.ok) {
    return applicationFailure("Unable to load Today suggestions right now.");
  }

  const timerSnapshot = timerResult.ok
    ? timerResult.value
    : { activeTimer: null, trackedTodaySeconds: 0 };

  // Build base TodayPlan via shared plan builder
  const plan = buildTodayPlan({
    today: localDate,
    selectedRows: selectedResult.value,
    pinnedRows: pinnedResult.value,
    inProgressRows: inProgressResult.value,
    activeTimer: timerSnapshot.activeTimer,
    trackedTodaySeconds: timerSnapshot.trackedTodaySeconds,
  });

  // Resolve optional signals — absent providers yield null, failures also yield null (load still succeeds)
  const resolveSignal = async (
    provider: OperatorSignalProviders[keyof OperatorSignalProviders],
  ): Promise<unknown | null> => {
    if (!provider) return null;
    try {
      const value = await provider(actor, localDate);
      return value ?? null;
    } catch {
      return null;
    }
  };

  const [health, friction, inbox, weeklyObjective] = await Promise.all([
    resolveSignal(input.signals?.health),
    resolveSignal(input.signals?.friction),
    resolveSignal(input.signals?.inbox),
    resolveSignal(input.signals?.weeklyObjective),
  ]);

  const snapshot = buildOperatorSnapshot({
    plan,
    timezone,
    timeContextId,
    dayWindow,
    signals: { health, friction, inbox, weeklyObjective },
  });

  return applicationSuccess(snapshot);
}
