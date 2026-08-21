import Ionicons from '@expo/vector-icons/Ionicons';

import type { TimerMode } from '@/lib/storage/timer';

export type { TimerMode };

export const TIMER_MODES: Record<
  TimerMode,
  { label: string; minutes: number; icon: keyof typeof Ionicons.glyphMap }
> = {
  focus: { label: 'Focus', minutes: 25, icon: 'flame-outline' },
  short_break: { label: 'Short Break', minutes: 5, icon: 'cafe-outline' },
  long_break: { label: 'Long Break', minutes: 15, icon: 'hourglass-outline' },
};
