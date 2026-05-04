const TASK_STATUS_VALUES = ['todo', 'in_progress', 'done', 'blocked'] as const;
const TASK_PRIORITY_VALUES = ['low', 'medium', 'high', 'urgent'] as const;

export type MobileTaskStatus = (typeof TASK_STATUS_VALUES)[number];
export type MobileTaskPriority = (typeof TASK_PRIORITY_VALUES)[number];
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

export type MobileTaskReminder = {
  id: string;
  taskId: string;
  remindAt: string;
  channel: 'email';
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
  sentAt: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MobileTaskRecurrenceRule =
  | 'daily'
  | 'weekdays'
  | 'weekly:sunday'
  | 'weekly:monday'
  | 'weekly:tuesday'
  | 'weekly:wednesday'
  | 'weekly:thursday'
  | 'weekly:friday'
  | 'weekly:saturday'
  | 'monthly:day-of-month';

export type MobileTaskRecurrence = {
  rule: MobileTaskRecurrenceRule;
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
  reminders: MobileTaskReminder[];
  recurrence: MobileTaskRecurrence | null;
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
  recurrenceRule?: MobileTaskRecurrenceRule | null;
};

export type UpdateTaskInput = {
  status?: MobileTaskStatus;
  priority?: MobileTaskPriority;
  dueDate?: string | null;
  estimateMinutes?: number | null;
  description?: string | null;
  blockedReason?: string | null;
  recurrenceRule?: MobileTaskRecurrenceRule | null;
};

export const MOBILE_TASK_RECURRENCE_RULE_VALUES = [
  'daily',
  'weekdays',
  'weekly:sunday',
  'weekly:monday',
  'weekly:tuesday',
  'weekly:wednesday',
  'weekly:thursday',
  'weekly:friday',
  'weekly:saturday',
  'monthly:day-of-month',
] as const satisfies readonly MobileTaskRecurrenceRule[];

export type UpdateMobileTaskInput = UpdateTaskInput;

export type CreateTaskReminderInput = {
  remindAt: string;
};

export type CancelTaskReminderInput = {
  reminderId: string;
};

export const MOBILE_TASK_STATUS_VALUES =
  TASK_STATUS_VALUES as readonly MobileTaskStatus[];

export const MOBILE_TASK_PRIORITY_VALUES =
  TASK_PRIORITY_VALUES as readonly MobileTaskPriority[];
