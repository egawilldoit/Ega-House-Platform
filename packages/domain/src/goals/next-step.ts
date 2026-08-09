export const GOAL_NEXT_STEP_MAX_LENGTH = 160;

export function normalizeGoalNextStepInput(
  value: string,
  maxLength = GOAL_NEXT_STEP_MAX_LENGTH,
) {
  const trimmed = value.trim();

  if (!trimmed) {
    return { value: null, error: null } as const;
  }

  if (trimmed.length > maxLength) {
    return {
      value: null,
      error: `Next step must be ${maxLength} characters or fewer.`,
    } as const;
  }

  return { value: trimmed, error: null } as const;
}
