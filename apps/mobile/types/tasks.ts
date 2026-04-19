export type MobileTaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked';
export type MobileTaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type MobileTaskDueFilter =
  | 'all'
  | 'overdue'
  | 'due_today'
  | 'due_soon'
  | 'no_due_date';

export type MobileTaskListItem = {
  id: string;
  title: string;
  description: string | null;
  status: MobileTaskStatus;
  priority: MobileTaskPriority;
  dueDate: string | null;
  estimateMinutes: number | null;
  updatedAt: string;
  focusRank: number | null;
  trackedDurationSeconds: number;
  project: {
    id: string;
    name: string;
  };
  goal: {
    id: string;
    title: string;
  } | null;
};

export type MobileTaskListResponse = {
  ok: true;
  tasks: MobileTaskListItem[];
  counters: {
    total: number;
    byStatus: Record<MobileTaskStatus, number>;
    pinned: number;
    overdue: number;
    dueToday: number;
  };
  filters: {
    status: MobileTaskStatus | null;
    projectId: string | null;
    goalId: string | null;
    due: MobileTaskDueFilter;
    sort: 'updated_desc' | 'due_date_asc' | 'due_date_desc';
    limit: number | null;
  };
  projects: Array<{ id: string; name: string }>;
  goals: Array<{ id: string; title: string }>;
};
