import type { GoalHealth, GoalReadModel } from '@ega/api-client';
import { GoalCard as CanonicalGoalCard } from '@/features/goals/components/GoalCard';
import { healthTone, statusTone } from '@/components/mobile/theme';

export function formatGoalToken(value: string) {
  return value.replaceAll('_', ' ');
}

export function goalHealthTone(health: GoalHealth | null) {
  return healthTone(health);
}

export function goalStatusTone(status: string) {
  return statusTone(status as never);
}

// Backward-compatible alias — canonical is features/goals/components/GoalCard.tsx
export function GoalCard({
  goal,
  saving,
  onPress,
  onActions,
}: {
  goal: GoalReadModel;
  saving?: boolean;
  onPress?: () => void;
  onActions: () => void;
}) {
  return (
    <CanonicalGoalCard
      goal={goal}
      saving={saving}
      onPress={onPress ?? onActions}
      onActions={onActions}
      onAddNextStep={onActions}
    />
  );
}
