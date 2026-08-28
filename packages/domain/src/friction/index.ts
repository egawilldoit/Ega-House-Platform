import { isGoalArchivedStatus } from "../goals/archive";
import { isTaskCompletedStatus } from "../tasks/status";

export const FRICTION_STALE_THRESHOLD_DAYS = 7;
export const FRICTION_STALE_THRESHOLD_MS =
  FRICTION_STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

export function getFrictionAgeMs(
  updatedAt: string | Date,
  now: Date = new Date(),
): number {
  const updated = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  const updatedMs = updated.getTime();
  if (Number.isNaN(updatedMs)) return 0;
  const diff = now.getTime() - updatedMs;
  return diff > 0 ? diff : 0;
}

export function getFrictionAgeDays(
  updatedAt: string | Date,
  now: Date = new Date(),
): number {
  return Math.floor(getFrictionAgeMs(updatedAt, now) / (24 * 60 * 60 * 1000));
}

export function isFrictionStale(
  updatedAt: string | Date,
  now: Date = new Date(),
  thresholdMs: number = FRICTION_STALE_THRESHOLD_MS,
): boolean {
  return getFrictionAgeMs(updatedAt, now) >= thresholdMs;
}

export type FrictionTaskCandidate = Readonly<{
  status: string | null | undefined;
  archivedAt: string | null | undefined;
  updatedAt: string;
}>;

export type FrictionGoalCandidate = Readonly<{
  status: string | null | undefined;
  updatedAt: string;
}>;

export function isActiveFrictionTask(
  task: FrictionTaskCandidate,
): boolean {
  if (task.archivedAt) return false;
  if (isTaskCompletedStatus(task.status)) return false;
  // canceled tasks are also excluded as terminal
  const normalized = String(task.status ?? "").trim().toLowerCase();
  if (normalized === "canceled" || normalized === "cancelled") return false;
  return true;
}

export function isActiveFrictionGoal(
  goal: FrictionGoalCandidate,
): boolean {
  if (isGoalArchivedStatus(goal.status)) return false;
  const normalized = String(goal.status ?? "").trim().toLowerCase();
  if (normalized === "done" || normalized === "completed" || normalized === "complete") return false;
  return true;
}

export function isBlockedFrictionTask(
  task: FrictionTaskCandidate & { status: string | null | undefined },
): boolean {
  if (!isActiveFrictionTask(task)) return false;
  return String(task.status ?? "").trim().toLowerCase() === "blocked";
}

export function isStaleFrictionTask(
  task: FrictionTaskCandidate,
  now: Date = new Date(),
  thresholdMs: number = FRICTION_STALE_THRESHOLD_MS,
): boolean {
  if (!isActiveFrictionTask(task)) return false;
  return isFrictionStale(task.updatedAt, now, thresholdMs);
}

export function isStaleFrictionGoal(
  goal: FrictionGoalCandidate,
  now: Date = new Date(),
  thresholdMs: number = FRICTION_STALE_THRESHOLD_MS,
): boolean {
  if (!isActiveFrictionGoal(goal)) return false;
  return isFrictionStale(goal.updatedAt, now, thresholdMs);
}
