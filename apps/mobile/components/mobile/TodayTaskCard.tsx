import { TodayTaskCard as FeatureTodayTaskCard } from '@/features/today/components/TodayTaskCard';

export function TodayTaskCard(props: {
  title: string;
  project: string;
  goal?: string | null;
  status: 'todo' | 'in_progress' | 'done' | 'blocked';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueLabel: string;
  blockedReason?: string | null;
  primaryActionLabel: string;
  muted?: boolean;
  busy?: boolean;
  onPrimaryAction: () => void;
  onOpen: () => void;
  onActions: () => void;
}) {
  return <FeatureTodayTaskCard {...props} />;
}
