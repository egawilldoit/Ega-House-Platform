import { formatTaskToken } from "./task-domain";

export const GOAL_HEALTH_VALUES = ["on_track", "at_risk", "off_track"] as const;

export type GoalHealth = (typeof GOAL_HEALTH_VALUES)[number];

type GoalHealthNormalizationResult =
  | {
      value: GoalHealth | null;
      error: null;
    }
  | {
      value: null;
      error: string;
    };

export function isGoalHealth(value: string): value is GoalHealth {
  return GOAL_HEALTH_VALUES.includes(value as GoalHealth);
}

export function toGoalHealthOrNull(value: string | null | undefined): GoalHealth | null {
  const normalized = value?.trim() ?? "";
  return isGoalHealth(normalized) ? normalized : null;
}

export function normalizeGoalHealthInput(value: string): GoalHealthNormalizationResult {
  const normalized = value.trim();

  if (!normalized) {
    return { value: null, error: null };
  }

  if (!isGoalHealth(normalized)) {
    return {
      value: null,
      error: `Health must be one of: ${GOAL_HEALTH_VALUES.join(", ")}.`,
    };
  }

  return {
    value: normalized,
    error: null,
  };
}

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
  if (value === "on_track") {
    return "active" as const;
  }

  if (value === "at_risk") {
    return "warn" as const;
  }

  return "error" as const;
}
