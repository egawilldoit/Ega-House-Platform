import {
  normalizeGoalHealthInput,
  type GoalHealth,
  type GoalHealthNormalizationResult,
} from "@ega/domain/goals";

import { formatTaskToken } from "./task-domain";

export {
  GOAL_HEALTH_VALUES,
  isGoalHealth,
  normalizeGoalHealthInput,
  toGoalHealthOrNull,
} from "@ega/domain/goals";
export type { GoalHealth, GoalHealthNormalizationResult } from "@ega/domain/goals";

function getGoalHealthFormValue(formData: FormData) {
  return String(formData.get("health") ?? formData.get("goal_health") ?? "");
}

export function toGoalHealthWriteValue(formData: FormData): GoalHealthNormalizationResult {
  return normalizeGoalHealthInput(getGoalHealthFormValue(formData));
}

export function getGoalHealthLabel(value: GoalHealth) {
  return formatTaskToken(value);
}

export function getGoalHealthTone(value: GoalHealth) {
  if (value === "on_track") return "active" as const;
  if (value === "at_risk") return "warn" as const;
  return "error" as const;
}
