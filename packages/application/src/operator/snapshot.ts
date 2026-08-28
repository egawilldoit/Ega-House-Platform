import { isTaskCompletedStatus } from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import { toLocalIsoDate } from "../shared/duration";
import type { TodayReadPort, TodayActiveTimer } from "../today/ports";
import { buildTodayPlan, type TodayPlan, type TodayPlanTask } from "../today/plan";

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

function getLocalIsoDate(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isScheduledTaskForToday(
  task: Pick<OperatorTask, "scheduledStartAt" | "scheduledEndAt">,
  today: string,
): boolean {
  if (!isValidScheduledTaskBlock(task) || !task.scheduledStartAt) return false;
  return getLocalIsoDate(task.scheduledStartAt) === today;
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
): { scheduledTasks: OperatorTask[]; flexibleTodayTasks: OperatorTask[] } {
  const scheduledTasks = tasks
    .filter((t) => isScheduledTaskForToday(t, today))
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
  signals?: Partial<OperatorSignals>;
}>;

export function buildOperatorSnapshot(input: BuildOperatorSnapshotInput): OperatorSnapshot {
  const plan = input.plan;
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

  const { scheduledTasks, flexibleTodayTasks } = groupTodayTasksForTimeline(allSelected, plan.date);

  const signals: OperatorSignals = {
    health: input.signals?.health ?? null,
    friction: input.signals?.friction ?? null,
    inbox: input.signals?.inbox ?? null,
    weeklyObjective: input.signals?.weeklyObjective ?? null,
  };

  return {
    date: plan.date,
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
  input: Readonly<{
    date?: unknown;
    now?: Date;
    signals?: OperatorSignalProviders;
  }> = {},
): Promise<ApplicationResult<OperatorSnapshot>> {
  const now = input.now ?? new Date();
  const rawDate = String(input.date ?? "").trim();
  const today = rawDate || toLocalIsoDate(now);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return applicationFailure("Today date is invalid.");
  }

  const nowIso = now.toISOString();
  const dayWindowStart = new Date(`${today}T00:00:00`);
  const windowStartIso = (() => {
    const dayStart = new Date(dayWindowStart);
    if (Number.isNaN(dayStart.valueOf())) return nowIso;
    dayStart.setHours(0, 0, 0, 0);
    return dayStart.toISOString();
  })();

  const [selectedResult, pinnedResult, inProgressResult, timerResult] = await Promise.all([
    todayPort.listSelectedTasks(actor, { today }),
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
    today,
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
      const value = await provider(actor, today);
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
    signals: { health, friction, inbox, weeklyObjective },
  });

  return applicationSuccess(snapshot);
}
