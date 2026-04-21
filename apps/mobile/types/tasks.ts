import type { TaskPriority, TaskStatus } from '../../../src/lib/task-domain';

export type MobileTaskStatus = TaskStatus;
export type MobileTaskPriority = TaskPriority;
export type MobileTaskDueFilter =
  | 'all'
  | 'overdue'
  | 'due_today'
  | 'due_soon'
  | 'no_due_date';
export type MobileTaskSortValue = 'updated_desc' | 'due_date_asc' | 'due_date_desc';

export type MobileTaskProject = {
  id: string;
  name: string;
};

export type MobileTaskGoal = {
  id: string;
  title: string;
};

export type MobileTaskListItem = {
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
  trackedDurationSeconds: number;
  project: MobileTaskProject;
  goal: MobileTaskGoal | null;
};

export type MobileTaskCounters = {
  total: number;
  byStatus: Record<MobileTaskStatus, number>;
  pinned: number;
  overdue: number;
  dueToday: number;
};

export type MobileTaskListFilters = {
  status: MobileTaskStatus | null;
  projectId: string | null;
  goalId: string | null;
  due: MobileTaskDueFilter;
  sort: MobileTaskSortValue;
  limit: number | null;
};

export type MobileTaskListResponse = {
  ok: true;
  tasks: MobileTaskListItem[];
  counters: MobileTaskCounters;
  filters: MobileTaskListFilters;
  projects: MobileTaskProject[];
  goals: MobileTaskGoal[];
};

export type MobileTaskMutationResponse = {
  ok: true;
  task: MobileTaskListItem;
};

export type CreateTaskInput = {
  title: string;
  projectId: string;
  goalId: string | null;
  description: string | null;
  blockedReason: string | null;
  status: MobileTaskStatus;
  priority: MobileTaskPriority;
  dueDate: string | null;
  estimateMinutes: number | null;
};

export type UpdateTaskInput = {
  status?: MobileTaskStatus;
  priority?: MobileTaskPriority;
  dueDate?: string | null;
  estimateMinutes?: number | null;
  description?: string | null;
  blockedReason?: string | null;
};

export type UpdateMobileTaskInput = UpdateTaskInput;

export const MOBILE_TASK_STATUS_VALUES = [
  'todo',
  'in_progress',
  'done',
  'blocked',
] as const satisfies readonly MobileTaskStatus[];

export const MOBILE_TASK_PRIORITY_VALUES = [
  'low',
  'medium',
  'high',
  'urgent',
] as const satisfies readonly MobileTaskPriority[];
