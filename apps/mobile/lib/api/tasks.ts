import type {
  TaskApiRecord,
  TaskApiRecurrence,
  TaskApiReminder,
} from '@ega/api-client';
import { getMobileEgaApiClient, unwrapApiResult } from '@/lib/api/ega';
import type {
  CancelTaskReminderInput,
  CreateTaskInput,
  CreateTaskReminderInput,
  MobileTaskCounters,
  MobileTaskDueFilter,
  MobileTaskListItemView,
  MobileTaskListViewResponse,
  MobileTaskRecurrence,
  MobileTaskReminderView,
  MobileTaskSortValue,
  MobileTaskStatus,
  UpdateTaskInput,
} from '@/types/tasks';

export type ListMobileTasksParams = {
  status?: MobileTaskStatus | null;
  projectId?: string | null;
  goalId?: string | null;
  due?: MobileTaskDueFilter;
  sort?: MobileTaskSortValue;
  limit?: number | null;
};

const DEFAULT_DUE_FILTER: MobileTaskDueFilter = 'all';
const DEFAULT_SORT_VALUE: MobileTaskSortValue = 'updated_desc';

function getTodayLocalIsoDate(now = new Date()) {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

function isCompletedStatus(status: MobileTaskStatus) {
  return status === 'done';
}

function isOverdue(dueDate: string | null, status: MobileTaskStatus, today: string) {
  return Boolean(dueDate && !isCompletedStatus(status) && dueDate < today);
}

function isDueToday(dueDate: string | null, status: MobileTaskStatus, today: string) {
  return Boolean(dueDate && !isCompletedStatus(status) && dueDate === today);
}

function isDueSoon(dueDate: string | null, status: MobileTaskStatus, today: string) {
  if (!dueDate || isCompletedStatus(status)) {
    return false;
  }

  const end = new Date(`${today}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 7);
  const rangeEnd = end.toISOString().slice(0, 10);
  return dueDate >= today && dueDate <= rangeEnd;
}

type DueSortableTask = {
  dueDate: string | null;
  status: MobileTaskStatus;
};

function filterTasksByDue<T extends DueSortableTask>(tasks: T[], due: MobileTaskDueFilter) {
  if (due === DEFAULT_DUE_FILTER) {
    return tasks;
  }

  const today = getTodayLocalIsoDate();
  switch (due) {
    case 'overdue':
      return tasks.filter((task) => isOverdue(task.dueDate, task.status, today));
    case 'due_today':
      return tasks.filter((task) => isDueToday(task.dueDate, task.status, today));
    case 'due_soon':
      return tasks.filter((task) => isDueSoon(task.dueDate, task.status, today));
    case 'no_due_date':
      return tasks.filter((task) => !task.dueDate);
    default:
      return tasks;
  }
}

function compareDueDates(
  left: string | null,
  right: string | null,
  direction: 'asc' | 'desc',
) {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return direction === 'asc'
    ? left.localeCompare(right)
    : right.localeCompare(left);
}

function sortTasksByValue<T extends DueSortableTask & { updatedAt: string }>(
  tasks: T[],
  sort: MobileTaskSortValue,
) {
  return [...tasks].sort((left, right) => {
    if (sort === 'due_date_asc') {
      const dueResult = compareDueDates(left.dueDate, right.dueDate, 'asc');
      return dueResult !== 0 ? dueResult : right.updatedAt.localeCompare(left.updatedAt);
    }

    if (sort === 'due_date_desc') {
      const dueResult = compareDueDates(left.dueDate, right.dueDate, 'desc');
      return dueResult !== 0 ? dueResult : right.updatedAt.localeCompare(left.updatedAt);
    }

    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

function mapReminder(reminder: TaskApiReminder): MobileTaskReminderView {
  return {
    id: reminder.id,
    taskId: reminder.taskId,
    remindAt: reminder.remindAt,
    channel: reminder.channel,
    status: reminder.status,
    sentAt: reminder.sentAt,
    failureReason: reminder.failureReason,
  };
}

function mapRecurrence(recurrence: TaskApiRecurrence | null): MobileTaskRecurrence | null {
  if (!recurrence) {
    return null;
  }

  return {
    rule: recurrence.rule as MobileTaskRecurrence['rule'],
    anchorDate: recurrence.anchorDate,
    timezone: recurrence.timezone,
    nextOccurrenceDate: recurrence.nextOccurrenceDate,
    lastGeneratedAt: recurrence.lastGeneratedAt,
  };
}

export function mapTaskApiRecordToViewItem(record: TaskApiRecord): MobileTaskListItemView {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    blockedReason: record.blockedReason,
    status: record.status,
    priority: record.priority,
    dueDate: record.dueDate,
    estimateMinutes: record.estimateMinutes,
    updatedAt: record.updatedAt,
    focusRank: record.focusRank,
    project: { id: record.projectId },
    goal: record.goalId ? { id: record.goalId } : null,
    reminders: record.reminders.map(mapReminder),
    recurrence: mapRecurrence(record.recurrence),
  };
}

function computeCounters(tasks: MobileTaskListItemView[]): MobileTaskCounters {
  const today = getTodayLocalIsoDate();

  return tasks.reduce<MobileTaskCounters>(
    (counters, task) => {
      counters.byStatus[task.status] += 1;
      counters.total += 1;
      if (task.focusRank !== null) {
        counters.pinned += 1;
      }
      if (isOverdue(task.dueDate, task.status, today)) {
        counters.overdue += 1;
      }
      if (isDueToday(task.dueDate, task.status, today)) {
        counters.dueToday += 1;
      }
      return counters;
    },
    {
      total: 0,
      byStatus: { todo: 0, in_progress: 0, done: 0, blocked: 0 },
      pinned: 0,
      overdue: 0,
      dueToday: 0,
    },
  );
}

export async function listMobileTasks(
  params: ListMobileTasksParams = {},
): Promise<MobileTaskListViewResponse> {
  const result = await getMobileEgaApiClient().tasks.list({
    status: params.status ?? null,
    projectId: params.projectId ?? null,
    goalId: params.goalId ?? null,
    limit: params.limit ?? null,
  });
  const data = unwrapApiResult(result);

  const dueFilter = params.due ?? DEFAULT_DUE_FILTER;
  const sortValue = params.sort ?? DEFAULT_SORT_VALUE;
  const tasks = sortTasksByValue(
    filterTasksByDue(data.tasks.map(mapTaskApiRecordToViewItem), dueFilter),
    sortValue,
  );

  return {
    ok: true,
    tasks,
    counters: computeCounters(tasks),
    filters: {
      status: params.status ?? null,
      projectId: params.projectId ?? null,
      goalId: params.goalId ?? null,
      due: dueFilter,
      sort: sortValue,
      limit: params.limit ?? null,
    },
    projects: [],
    goals: [],
  };
}

export async function getMobileTaskById(taskId: string) {
  const task = unwrapApiResult(await getMobileEgaApiClient().tasks.get(taskId));
  return { ok: true as const, task: mapTaskApiRecordToViewItem(task) };
}

export async function createMobileTask(input: CreateTaskInput) {
  const response = unwrapApiResult(await getMobileEgaApiClient().tasks.create(input));
  return { ok: true as const, task: mapTaskApiRecordToViewItem(response.task) };
}

export async function updateMobileTask(taskId: string, input: UpdateTaskInput) {
  const response = unwrapApiResult(await getMobileEgaApiClient().tasks.update(taskId, input));
  return { ok: true as const, task: mapTaskApiRecordToViewItem(response.task) };
}

export async function createMobileTaskReminder(taskId: string, input: CreateTaskReminderInput) {
  const response = unwrapApiResult(
    await getMobileEgaApiClient().tasks.createReminder(taskId, input.remindAt),
  );
  return { ok: true as const, task: mapTaskApiRecordToViewItem(response.task) };
}

export async function cancelMobileTaskReminder(taskId: string, input: CancelTaskReminderInput) {
  const response = unwrapApiResult(
    await getMobileEgaApiClient().tasks.cancelReminder(taskId, input.reminderId),
  );
  return { ok: true as const, task: mapTaskApiRecordToViewItem(response.task) };
}
