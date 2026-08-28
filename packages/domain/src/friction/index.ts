import { isGoalArchivedStatus } from "../goals/archive";
import { isTaskCompletedStatus } from "../tasks/status";

export const FRICTION_STALE_THRESHOLD_DAYS = 7;
export const FRICTION_STALE_THRESHOLD_MS =
  FRICTION_STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Estimate accuracy thresholds — deterministic, owned in domain.
// ---------------------------------------------------------------------------

/** Meaningful estimate minimum — below this we do not evaluate accuracy. */
export const FRICTION_ESTIMATE_MIN_MEANINGFUL_MINUTES = 5;

/** Estimate friction threshold: percent error magnitude > 50% is friction. */
export const FRICTION_ESTIMATE_PERCENT_THRESHOLD = 50;

/** Estimate high severity: percent error magnitude > 100% is high. */
export const FRICTION_ESTIMATE_HIGH_PERCENT_THRESHOLD = 100;

// ---------------------------------------------------------------------------
// Context-switch thresholds — deterministic, owned in domain.
// ---------------------------------------------------------------------------

/** Switch count that triggers friction (medium severity). */
export const FRICTION_CONTEXT_SWITCH_THRESHOLD = 6;

/** Switch count that escalates to high severity. */
export const FRICTION_CONTEXT_SWITCH_HIGH_THRESHOLD = 10;

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

// ---------------------------------------------------------------------------
// Estimate accuracy helpers — pure, deterministic.
// ---------------------------------------------------------------------------

export function isMeaningfulFrictionEstimate(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= FRICTION_ESTIMATE_MIN_MEANINGFUL_MINUTES;
}

export function getFrictionEstimatePercentError(
  actualMinutes: number,
  estimateMinutes: number,
): number | null {
  if (!Number.isFinite(actualMinutes) || !Number.isFinite(estimateMinutes)) return null;
  if (!isMeaningfulFrictionEstimate(estimateMinutes)) return null;
  if (estimateMinutes === 0) return actualMinutes > 0 ? Infinity : 0;
  return Math.round(((actualMinutes - estimateMinutes) / estimateMinutes) * 100);
}

export type FrictionEstimateSeverity = "none" | "low" | "medium" | "high";

export function getFrictionEstimateSeverity(percentError: number | null): FrictionEstimateSeverity {
  if (percentError === null || !Number.isFinite(percentError)) {
    // Infinity is finite? No, Infinity not finite, treat as high.
    if (percentError === Infinity || percentError === -Infinity) return "high";
    return "none";
  }
  const abs = Math.abs(percentError);
  if (abs > FRICTION_ESTIMATE_HIGH_PERCENT_THRESHOLD) return "high";
  if (abs > FRICTION_ESTIMATE_PERCENT_THRESHOLD) return "medium";
  if (abs > 0) return "low";
  return "none";
}

export function isFrictionEstimateMismatch(percentError: number | null): boolean {
  const severity = getFrictionEstimateSeverity(percentError);
  return severity === "medium" || severity === "high";
}

// ---------------------------------------------------------------------------
// Context-switch helpers — pure, deterministic.
// ---------------------------------------------------------------------------

export function getFrictionContextSwitchCount(taskIdsInOrder: string[]): number {
  let switches = 0;
  for (let i = 1; i < taskIdsInOrder.length; i++) {
    if (taskIdsInOrder[i] !== taskIdsInOrder[i - 1]) switches += 1;
  }
  return switches;
}

export type FrictionContextSwitchSeverity = "none" | "low" | "medium" | "high";

export function getFrictionContextSwitchSeverity(switchCount: number): FrictionContextSwitchSeverity {
  if (!Number.isFinite(switchCount) || switchCount < 0) return "none";
  if (switchCount >= FRICTION_CONTEXT_SWITCH_HIGH_THRESHOLD) return "high";
  if (switchCount >= FRICTION_CONTEXT_SWITCH_THRESHOLD) return "medium";
  if (switchCount > 0) return "low";
  return "none";
}

export function isFrictionContextSwitchFriction(switchCount: number): boolean {
  const severity = getFrictionContextSwitchSeverity(switchCount);
  return severity === "medium" || severity === "high";
}
