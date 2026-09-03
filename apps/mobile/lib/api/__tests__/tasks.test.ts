/**
 * Unit tests for the mobile task API wrappers (lib/api/tasks.ts) after the
 * canonical Hono cutover. Proves every call delegates to the @ega/api-client
 * tasks surface on the CANONICAL paths (/api/tasks*) — never /api/mobile/* —
 * and that errors thrown carry the server envelope message.
 */
import type { EgaApiClient } from '@ega/api-client';
import {
  setMobileEgaApiClientForTesting,
} from '@/lib/api/ega';
import {
  cancelMobileTaskReminder,
  createMobileTaskReminder,
  createMobileTask,
  getMobileTaskById,
  listMobileTasks,
  updateMobileTask,
} from '@/lib/api/tasks';

const list = jest.fn();
const get = jest.fn();
const create = jest.fn();
const update = jest.fn();
const createReminder = jest.fn();
const cancelReminder = jest.fn();

function makeFullFakeClient(): EgaApiClient {
  return {
    health: jest.fn(),
    auth: { login: jest.fn(), refresh: jest.fn(), logout: jest.fn() },
    projects: { list: jest.fn(), getBySlug: jest.fn(), create: jest.fn(), updateStatus: jest.fn(), archive: jest.fn(), unarchive: jest.fn(), remove: jest.fn() },
    goals: { list: jest.fn(), create: jest.fn(), updateStatus: jest.fn(), updateHealth: jest.fn(), updateNextStep: jest.fn(), archive: jest.fn(), unarchive: jest.fn() },
    tasks: { list, get, create, update, archive: jest.fn(), unarchive: jest.fn(), createReminder, cancelReminder, setRecurrence: jest.fn(), clearRecurrence: jest.fn(), pin: jest.fn(), unpin: jest.fn() },
    inbox: { list: jest.fn(), get: jest.fn(), create: jest.fn(), update: jest.fn(), archive: jest.fn(), restore: jest.fn(), convert: jest.fn() },
    today: { get: jest.fn(), plan: jest.fn(), remove: jest.fn(), updateStatus: jest.fn(), clearCompleted: jest.fn() },
    operator: { create: jest.fn(), revise: jest.fn(), approve: jest.fn(), apply: jest.fn(), dismiss: jest.fn(), get: jest.fn(), list: jest.fn() },
    weeklyReview: { get: jest.fn() },
    healthSnapshot: { getSnapshot: jest.fn() },
    friction: { radar: jest.fn() },
    timeContext: { get: jest.fn() },
    timer: { workspace: jest.fn(), start: jest.fn(), stop: jest.fn() },
    notifications: { list: jest.fn(), unreadCount: jest.fn(), markRead: jest.fn(), markOpened: jest.fn(), markAllRead: jest.fn(), registerDevice: jest.fn(), unregisterDevice: jest.fn(), preferences: jest.fn(), updatePreferences: jest.fn() },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  setMobileEgaApiClientForTesting(makeFullFakeClient());
});

afterEach(() => {
  setMobileEgaApiClientForTesting(null);
});

describe('listMobileTasks', () => {
  it('delegates filters onto the canonical /api/tasks surface', async () => {
    list.mockResolvedValue({ ok: true, data: { ok: true, tasks: [], counters: {}, filters: {}, projects: [], goals: [] } });

    await listMobileTasks({
      status: 'todo',
      projectId: 'p-1',
      goalId: 'g-1',
      priority: 'urgent',
      due: 'overdue',
      sort: 'due_date_asc',
      limit: 50,
    });

    expect(list).toHaveBeenCalledWith({
      status: 'todo',
      projectId: 'p-1',
      goalId: 'g-1',
      priority: 'urgent',
      due: 'overdue',
      sort: 'due_date_asc',
      limit: 50,
    });
  });

  it('omits unset filters entirely', async () => {
    list.mockResolvedValue({ ok: true, data: {} });

    await listMobileTasks({ priority: null, due: 'all' });

    expect(list).toHaveBeenCalledWith({ due: 'all' });
  });

  it('throws the server message when the envelope reports failure', async () => {
    list.mockResolvedValue({
      ok: false,
      error: { code: 'VALIDATION', message: 'Invalid due filter.', status: 400 },
    });

    await expect(listMobileTasks({ due: 'yesterday' as never })).rejects.toThrow(
      'Invalid due filter.',
    );
  });
});

describe('task mutation wrappers delegate to the canonical client', () => {
  beforeEach(() => {
    const taskResponse = { ok: true as const, data: { ok: true as const, task: { id: 'task-1' } } };
    get.mockResolvedValue(taskResponse);
    create.mockResolvedValue(taskResponse);
    update.mockResolvedValue(taskResponse);
    createReminder.mockResolvedValue(taskResponse);
    cancelReminder.mockResolvedValue(taskResponse);
  });

  it('get/create/update/reminders hit their canonical resource methods and unwrap results', async () => {
    const unwrappedTask = await getMobileTaskById('task-1');
    await createMobileTask({
      title: 'New task',
      projectId: 'p-1',
      goalId: null,
      description: null,
      blockedReason: null,
      status: 'todo',
      priority: 'medium',
      dueDate: null,
      estimateMinutes: null,
    });
    await updateMobileTask('task-1', { status: 'done' });
    await createMobileTaskReminder('task-1', { remindAt: '2026-09-01T09:00:00.000Z' });
    await cancelMobileTaskReminder('task-1', { reminderId: 'reminder-1' });

    expect(get).toHaveBeenCalledWith('task-1');
    expect(create).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith('task-1', { status: 'done' });
    expect(createReminder).toHaveBeenCalledWith('task-1', '2026-09-01T09:00:00.000Z', undefined);
    expect(cancelReminder).toHaveBeenCalledWith('task-1', 'reminder-1');

    expect(unwrappedTask).toEqual({ ok: true, task: { id: 'task-1' } });
  });
});
