import {
  GOAL_NEXT_STEP_MAX_LENGTH,
  normalizeGoalNextStepInput,
} from "@ega/domain/goals";

export { GOAL_NEXT_STEP_MAX_LENGTH, normalizeGoalNextStepInput } from "@ega/domain/goals";

export function readGoalNextStepFromFormData(formData: FormData) {
  return String(formData.get("next_step") ?? formData.get("nextStep") ?? "");
}

export function toGoalNextStepWriteValue(
  formData: FormData,
  maxLength = GOAL_NEXT_STEP_MAX_LENGTH,
) {
  return normalizeGoalNextStepInput(readGoalNextStepFromFormData(formData), maxLength);
}

export function getGoalNextStepPreview(
  value: string | null | undefined,
  maxLength = 90,
) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength).trimEnd()}…`;
}
