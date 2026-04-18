export const GOAL_NEXT_STEP_MAX_LENGTH = 160;

export function normalizeGoalNextStepInput(
  value: string,
  maxLength = GOAL_NEXT_STEP_MAX_LENGTH,
) {
  const trimmed = value.trim();

  if (!trimmed) {
    return {
      value: null,
      error: null,
    } as const;
  }

  if (trimmed.length > maxLength) {
    return {
      value: null,
      error: `Next step must be ${maxLength} characters or fewer.`,
    } as const;
  }

  return {
    value: trimmed,
    error: null,
  } as const;
}

export function readGoalNextStepFromFormData(formData: FormData) {
  return String(formData.get("next_step") ?? formData.get("nextStep") ?? "");
}

export function toGoalNextStepWriteValue(
  formData: FormData,
  maxLength = GOAL_NEXT_STEP_MAX_LENGTH,
) {
  return normalizeGoalNextStepInput(
    readGoalNextStepFromFormData(formData),
    maxLength,
  );
}

export function getGoalNextStepPreview(
  value: string | null | undefined,
  maxLength = 90,
) {
  const trimmed = value?.trim() ?? "";

  if (!trimmed) {
    return null;
  }

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength).trimEnd()}…`;
}
