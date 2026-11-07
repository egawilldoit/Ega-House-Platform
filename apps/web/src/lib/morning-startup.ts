import type { OperatorSnapshot, OperatorTask } from "@ega/application";
import { isTaskCompletedStatus } from "@ega/domain";
import type { UserPreferences } from "@ega/domain/preferences";

/**
 * Pure model for the after-Fajr Morning Startup panel on the existing Today
 * page (#344).
 *
 * This module owns presentation-ready derivation only: it reads the canonical
 * Operator snapshot, the owner's weekly targets and a bounded yesterday read.
 * It never persists anything and never schedules a prayer or guidance block.
 * Guidance remains configurable data; the panel is not a scheduler.
 *
 * Durable per-day startup dismissal is intentionally NOT implemented here.
 * If that requirement arrives, its contract belongs to #345's daily-check-in
 * owner/day record (one owner-scoped day row), not to this URL-state slice.
 * Skip/resume is ephemeral `?startup=skipped` state only: no cookie, table,
 * column or migration.
 */

export const MORNING_STARTUP_OUTCOME_LIMIT = 3;
export const MORNING_STARTUP_YESTERDAY_LIMIT = 5;
export const MORNING_STARTUP_CARRYOVER_LIMIT = 5;
export const MORNING_STARTUP_PROJECT_GROUP_LIMIT = 4;
export const MORNING_STARTUP_GROUP_TASK_LIMIT = 5;

export const MORNING_OUTCOME_EMPTY_MESSAGE =
  "Choose at least one outcome task to start your day.";
export const MORNING_OUTCOME_LIMIT_MESSAGE = "Choose no more than 3 outcome tasks.";
export const MORNING_OUTCOME_UNAVAILABLE_MESSAGE =
  "The selected outcome tasks are unavailable.";
export const MORNING_OUTCOME_ARCHIVED_MESSAGE = "Archived tasks cannot start your day.";
export const MORNING_OUTCOME_COMPLETED_MESSAGE = "Completed tasks cannot start your day.";
export const MORNING_OUTCOME_BLOCKED_MESSAGE = "Blocked tasks cannot start your day.";
export const MORNING_OUTCOME_REVIEW_MESSAGE = "Tasks in review cannot start your day.";
export const MORNING_OUTCOME_MIXED_PROJECT_MESSAGE =
  "Choose outcome tasks from a single project.";

export const MORNING_STARTUP_YESTERDAY_ERROR_MESSAGE =
  "Yesterday's completed work is unavailable right now.";

export const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export type MorningStartupWeekday = (typeof WEEKDAYS)[number];

export type MorningStartupProject = Readonly<{
  key: string;
  projectName: string;
  projectSlug: string | null;
}>;

export type MorningStartupCandidateTask = Readonly<{
  id: string;
  title: string;
  projectName: string;
  projectSlug: string | null;
  estimateMinutes: number | null;
  status: string;
  isPlannedForToday: boolean;
}>;

export type MorningStartupProjectGroup = Readonly<{
  key: string;
  projectName: string;
  projectSlug: string | null;
  tasks: MorningStartupCandidateTask[];
  isPrimary: boolean;
}>;

export type MorningStartupYesterdayTask = Readonly<{
  id: string;
  title: string;
  projectName: string | null;
  projectSlug: string | null;
  completedAt: string | null;
}>;

export type MorningStartupCarryoverTask = Readonly<{
  id: string;
  title: string;
  projectName: string;
  projectSlug: string | null;
  status: string;
}>;

export type MorningStartupSelectedOutcome = Readonly<{
  id: string;
  title: string;
  projectName: string;
  projectSlug: string | null;
}>;

export type MorningStartupYesterdayRow = Readonly<{
  id: string;
  title: string;
  projectName: string | null;
  projectSlug: string | null;
  completedAt: string | null;
}>;

export type MorningStartupOwnedTaskRow = Readonly<{
  id: string;
  status: string;
  archivedAt: string | null;
  projectId: string;
  projectName: string | null;
  projectSlug: string | null;
}>;

export type MorningStartupModel = Readonly<{
  date: string;
  timezone: string;
  weekday: MorningStartupWeekday;
  workTargetMinutes: number;
  workTargetLabel: string;
  isRestDay: boolean;
  paused: boolean;
  yesterday: Readonly<{
    completedCount: number;
    tasks: MorningStartupYesterdayTask[];
    errorMessage: string | null;
  }>;
  carryovers: Readonly<{
    count: number;
    tasks: MorningStartupCarryoverTask[];
  }>;
  groups: MorningStartupProjectGroup[];
  selectedOutcomeIds: string[];
  selectedOutcomes: MorningStartupSelectedOutcome[];
  primaryProject: MorningStartupProject | null;
  skipped: boolean;
}>;

export type BuildMorningStartupModelInput = Readonly<{
  snapshot: OperatorSnapshot;
  yesterdayRows: readonly MorningStartupYesterdayRow[];
  preferences: UserPreferences;
  date: string;
  timezone: string;
  skipped: boolean;
  yesterdayErrorMessage?: string | null;
}>;

export type NormalizeOutcomeTaskIdsResult =
  | Readonly<{ ok: true; taskIds: string[] }>
  | Readonly<{ ok: false; errorMessage: string }>;

export type ValidateMorningOutcomeTasksResult =
  | Readonly<{ ok: true; tasks: MorningStartupOwnedTaskRow[] }>
  | Readonly<{ ok: false; errorMessage: string }>;

function isActionableStatus(status: string): boolean {
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized === "todo" || normalized === "in_progress";
}

function projectKeyForTask(
  task: Pick<OperatorTask, "projectName" | "projectSlug">,
): string {
  const slug = task.projectSlug?.trim();
  if (slug) return slug;
  const name = task.projectName?.trim();
  return name || "unassigned";
}

export function getMorningStartupWeekday(date: string): MorningStartupWeekday {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return "monday";
  }
  return WEEKDAYS[parsed.getUTCDay()] ?? "monday";
}

export function formatWorkTargetMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return "No work target";
  }

  const safeMinutes = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const remainingMinutes = safeMinutes % 60;

  if (hours === 0) return `${remainingMinutes}m`;
  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainingMinutes}m`;
}

function dedupeTasksById(tasks: readonly OperatorTask[]): OperatorTask[] {
  const byId = new Map<string, OperatorTask>();
  for (const task of tasks) {
    if (!byId.has(task.id)) byId.set(task.id, task);
  }
  return [...byId.values()];
}

function collectCandidateTasks(snapshot: OperatorSnapshot): OperatorTask[] {
  return dedupeTasksById([
    ...snapshot.plannedToday,
    ...snapshot.focus.queue,
    ...snapshot.suggestions.pinned,
    ...snapshot.suggestions.inProgress,
    ...snapshot.sections.planned,
    ...snapshot.sections.inProgress,
  ]).filter((task) => isActionableStatus(task.status));
}

function collectSelectedOutcomes(snapshot: OperatorSnapshot): OperatorTask[] {
  return dedupeTasksById([
    ...snapshot.plannedToday,
    ...snapshot.focus.queue.filter((task) => task.isPlannedForToday),
  ])
    .filter((task) => isActionableStatus(task.status))
    .slice(0, MORNING_STARTUP_OUTCOME_LIMIT);
}

function derivePrimaryProject(
  selectedOutcomes: readonly OperatorTask[],
): MorningStartupProject | null {
  if (selectedOutcomes.length === 0) return null;
  const keys = new Set(selectedOutcomes.map(projectKeyForTask));
  if (keys.size !== 1) return null;
  const first = selectedOutcomes[0];
  return {
    key: projectKeyForTask(first),
    projectName: first.projectName,
    projectSlug: first.projectSlug,
  };
}

function buildProjectGroups(
  candidateTasks: readonly OperatorTask[],
  primaryProject: MorningStartupProject | null,
): MorningStartupProjectGroup[] {
  const grouped = new Map<string, OperatorTask[]>();

  for (const task of candidateTasks) {
    const key = projectKeyForTask(task);
    const group = grouped.get(key) ?? [];
    if (group.length >= MORNING_STARTUP_GROUP_TASK_LIMIT) continue;
    group.push(task);
    grouped.set(key, group);
  }

  return [...grouped.entries()]
    .sort(([leftKey, leftTasks], [rightKey, rightTasks]) => {
      if (primaryProject) {
        if (leftKey === primaryProject.key) return -1;
        if (rightKey === primaryProject.key) return 1;
      }
      const byName = leftTasks[0].projectName.localeCompare(rightTasks[0].projectName);
      return byName !== 0 ? byName : leftKey.localeCompare(rightKey);
    })
    .slice(0, MORNING_STARTUP_PROJECT_GROUP_LIMIT)
    .map(([key, tasks]) => ({
      key,
      projectName: tasks[0].projectName,
      projectSlug: tasks[0].projectSlug,
      isPrimary: primaryProject?.key === key,
      tasks: tasks.map((task) => ({
        id: task.id,
        title: task.title,
        projectName: task.projectName,
        projectSlug: task.projectSlug,
        estimateMinutes: task.estimateMinutes,
        status: task.status,
        isPlannedForToday: task.isPlannedForToday,
      })),
    }));
}

function buildCarryovers(snapshot: OperatorSnapshot): {
  count: number;
  tasks: MorningStartupCarryoverTask[];
} {
  const carryoverTasks = dedupeTasksById([
    ...snapshot.sections.inProgress,
    ...snapshot.sections.planned,
  ])
    .filter((task) => !task.isPlannedForToday)
    .filter((task) => task.status !== "blocked" && !isTaskCompletedStatus(task.status));

  return {
    count: carryoverTasks.length,
    tasks: carryoverTasks.slice(0, MORNING_STARTUP_CARRYOVER_LIMIT).map((task) => ({
      id: task.id,
      title: task.title,
      projectName: task.projectName,
      projectSlug: task.projectSlug,
      status: task.status,
    })),
  };
}

export function buildMorningStartupModel(
  input: BuildMorningStartupModelInput,
): MorningStartupModel {
  const weekday = getMorningStartupWeekday(input.date);
  const target = input.preferences.personalOperations.targets[weekday];
  const workTargetMinutes = Math.max(0, Math.trunc(target?.work ?? 0));
  const selectedOutcomeTasks = collectSelectedOutcomes(input.snapshot);
  const primaryProject = derivePrimaryProject(selectedOutcomeTasks);
  const candidateTasks = collectCandidateTasks(input.snapshot);
  const groups = buildProjectGroups(candidateTasks, primaryProject);
  const carryovers = buildCarryovers(input.snapshot);

  return {
    date: input.date,
    timezone: input.timezone,
    weekday,
    workTargetMinutes,
    workTargetLabel: formatWorkTargetMinutes(workTargetMinutes),
    isRestDay: workTargetMinutes === 0,
    paused: input.preferences.personalOperations.paused,
    yesterday: {
      completedCount: input.yesterdayRows.length,
      tasks: input.yesterdayRows
        .slice(0, MORNING_STARTUP_YESTERDAY_LIMIT)
        .map((row) => ({
          id: row.id,
          title: row.title,
          projectName: row.projectName,
          projectSlug: row.projectSlug,
          completedAt: row.completedAt,
        })),
      errorMessage: input.yesterdayErrorMessage ?? null,
    },
    carryovers,
    groups,
    selectedOutcomeIds: selectedOutcomeTasks.map((task) => task.id),
    selectedOutcomes: selectedOutcomeTasks.map((task) => ({
      id: task.id,
      title: task.title,
      projectName: task.projectName,
      projectSlug: task.projectSlug,
    })),
    primaryProject,
    skipped: input.skipped,
  };
}

/**
 * Normalise submitted outcome ids: trim, drop empty/non-string values, dedupe
 * in submitted order, then enforce the 1-3 bound with distinct messages.
 */
export function normalizeOutcomeTaskIds(raw: unknown): NormalizeOutcomeTaskIdsResult {
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const seen = new Set<string>();
  const taskIds: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") continue;
    const id = value.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    taskIds.push(id);
  }

  if (taskIds.length === 0) {
    return { ok: false, errorMessage: MORNING_OUTCOME_EMPTY_MESSAGE };
  }

  if (taskIds.length > MORNING_STARTUP_OUTCOME_LIMIT) {
    return { ok: false, errorMessage: MORNING_OUTCOME_LIMIT_MESSAGE };
  }

  return { ok: true, taskIds };
}

function dedupeOwnedRows(
  rows: readonly MorningStartupOwnedTaskRow[],
): MorningStartupOwnedTaskRow[] {
  const byId = new Map<string, MorningStartupOwnedTaskRow>();
  for (const row of rows) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  return [...byId.values()];
}

/**
 * Validate the owner-scoped task rows that were read back for the submitted
 * ids. The caller must also confirm that every submitted id was found; this
 * function rejects an empty set but cannot see omitted ids.
 */
export function validateMorningOutcomeTasks(
  rows: readonly MorningStartupOwnedTaskRow[],
): ValidateMorningOutcomeTasksResult {
  const uniqueRows = dedupeOwnedRows(rows);

  if (uniqueRows.length === 0) {
    return { ok: false, errorMessage: MORNING_OUTCOME_UNAVAILABLE_MESSAGE };
  }

  if (uniqueRows.length > MORNING_STARTUP_OUTCOME_LIMIT) {
    return { ok: false, errorMessage: MORNING_OUTCOME_LIMIT_MESSAGE };
  }

  for (const row of uniqueRows) {
    if (row.archivedAt) {
      return { ok: false, errorMessage: MORNING_OUTCOME_ARCHIVED_MESSAGE };
    }

    const status = String(row.status ?? "").trim().toLowerCase();
    if (isTaskCompletedStatus(status)) {
      return { ok: false, errorMessage: MORNING_OUTCOME_COMPLETED_MESSAGE };
    }
    if (status === "blocked") {
      return { ok: false, errorMessage: MORNING_OUTCOME_BLOCKED_MESSAGE };
    }
    if (status === "review") {
      return { ok: false, errorMessage: MORNING_OUTCOME_REVIEW_MESSAGE };
    }
    if (status !== "todo" && status !== "in_progress") {
      return { ok: false, errorMessage: MORNING_OUTCOME_UNAVAILABLE_MESSAGE };
    }
  }

  const projectIds = new Set(uniqueRows.map((row) => row.projectId));
  if (projectIds.size !== 1) {
    return { ok: false, errorMessage: MORNING_OUTCOME_MIXED_PROJECT_MESSAGE };
  }

  return { ok: true, tasks: uniqueRows };
}
