import type { MobileTaskPriority, MobileTaskStatus } from '@/types/tasks';

export type MobileTodayTask = {
  id: string;
  title: string;
  description: string | null;
  blockedReason: string | null;
  status: MobileTaskStatus;
  priority: MobileTaskPriority;
  dueDate: string | null;
  estimateMinutes: number | null;
  updatedAt: string;
  focusRank: number | null;
  plannedForDate: string | null;
  projectName: string;
  projectSlug: string | null;
  goalTitle: string | null;
  hasActiveTimer: boolean;
  isDueToday: boolean;
  isPlannedForToday: boolean;
};

export type MobileTodaySummary = {
  plannedCount: number;
  inProgressCount: number;
  blockedCount: number;
  completedCount: number;
  clearableCompletedCount: number;
  totalEstimateMinutes: number;
  trackedTodaySeconds: number;
  trackedTodayLabel: string;
};

export type MobileTodayResponse = {
  ok: true;
  date: string;
  sections: {
    planned: MobileTodayTask[];
    inProgress: MobileTodayTask[];
    blocked: MobileTodayTask[];
    completed: MobileTodayTask[];
  };
  suggestions: {
    pinned: MobileTodayTask[];
    inProgress: MobileTodayTask[];
  };
  summary: MobileTodaySummary;
  activeTimer: {
    sessionId: string;
    taskId: string;
  } | null;
};

export type MobileTodayTaskStatusMutationResponse = {
  ok: true;
  taskId: string;
  status: MobileTaskStatus;
};

export type MobileTodayTaskMutationResponse = {
  ok: true;
  taskId: string;
};

export type MobileTodayClearCompletedResponse = {
  ok: true;
};
