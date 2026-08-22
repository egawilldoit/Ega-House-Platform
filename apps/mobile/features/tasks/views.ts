import type {
  MobileTaskDueFilter,
  MobileTaskSortValue,
  MobileTaskStatus,
} from '@/types/tasks';

export type TaskViewId = 'all' | 'today' | 'overdue' | 'blocked' | 'no_due_date';

export type TaskViewState = {
  status: MobileTaskStatus | 'all';
  due: MobileTaskDueFilter;
  sort: MobileTaskSortValue;
};

export type TaskViewPreset = TaskViewState & {
  id: TaskViewId;
  label: string;
};

export const TASK_VIEW_PRESETS: readonly TaskViewPreset[] = [
  { id: 'all', label: 'All', status: 'all', due: 'all', sort: 'updated_desc' },
  { id: 'today', label: 'Today', status: 'all', due: 'due_today', sort: 'due_date_asc' },
  { id: 'overdue', label: 'Overdue', status: 'all', due: 'overdue', sort: 'due_date_asc' },
  { id: 'blocked', label: 'Blocked', status: 'blocked', due: 'all', sort: 'updated_desc' },
  {
    id: 'no_due_date',
    label: 'No due date',
    status: 'all',
    due: 'no_due_date',
    sort: 'updated_desc',
  },
] as const;

const DEFAULT_TASK_VIEW_PRESET: TaskViewPreset = TASK_VIEW_PRESETS[0];

export function getTaskViewPreset(id: TaskViewId): TaskViewPreset {
  const preset = TASK_VIEW_PRESETS.find((item) => item.id === id);
  return preset ?? DEFAULT_TASK_VIEW_PRESET;
}

export function matchTaskViewPreset(state: TaskViewState): TaskViewId | null {
  const preset = TASK_VIEW_PRESETS.find(
    (item) => item.status === state.status && item.due === state.due && item.sort === state.sort,
  );
  return preset ? preset.id : null;
}
