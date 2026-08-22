/**
 * Unit tests for the mobile task API wrappers (lib/api/tasks.ts).
 * Proves list params — including the canonical priority filter — are
 * serialized onto /api/mobile/tasks exactly as the server validates them,
 * and that mutations target the right paths with auth enabled.
 */
import { mobileApiFetch } from '@/lib/api/client';
import {
  cancelMobileTaskReminder,
  createMobileTaskReminder,
  createMobileTask,
  getMobileTaskById,
  listMobileTasks,
  updateMobileTask,
} from '@/lib/api/tasks';

jest.mock('@/lib/api/client', () => ({
  mobileApiFetch: jest.fn(),
}));

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as jest.MockedFunction<T>;

const mockFetch = mock(mobileApiFetch);

describe('listMobileTasks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true });
  });

  it('requests the enriched canonical task list without filters by default', async () => {
    await listMobileTasks();

    expect(mockFetch).toHaveBeenCalledWith('/api/mobile/tasks', { method: 'GET', auth: true });
  });

  it('serializes priority alongside existing filters in a stable order', async () => {
    await listMobileTasks({
      status: 'todo',
      projectId: 'p-1',
      goalId: 'g-1',
      priority: 'urgent',
      due: 'overdue',
      sort: 'due_date_asc',
      limit: 50,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/mobile/tasks?status=todo&projectId=p-1&goalId=g-1&priority=urgent&due=overdue&sort=due_date_asc&limit=50',
      { method: 'GET', auth: true },
    );
  });

  it('omits null priority instead of sending an empty filter', async () => {
    await listMobileTasks({ priority: null, due: 'all' });

    expect(mockFetch).toHaveBeenCalledWith('/api/mobile/tasks?due=all', { method: 'GET', auth: true });
  });
});

describe('task mutation wrappers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true });
  });

  it('creates tasks against the canonical mobile route', async () => {
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

    expect(mockFetch).toHaveBeenCalledWith('/api/mobile/tasks', expect.objectContaining({ method: 'POST' }));
  });

  it('targets detail, reminder, and update paths per task id', async () => {
    await getMobileTaskById('task-1');
    await updateMobileTask('task-1', { status: 'done' });
    await createMobileTaskReminder('task-1', { remindAt: '2026-09-01T09:00:00.000Z' });
    await cancelMobileTaskReminder('task-1', { reminderId: 'reminder-1' });

    const paths = mockFetch.mock.calls.map((call) => call[0]);
    expect(paths).toEqual([
      '/api/mobile/tasks/task-1',
      '/api/mobile/tasks/task-1',
      '/api/mobile/tasks/task-1/reminders',
      '/api/mobile/tasks/task-1/reminders/reminder-1',
    ]);
  });
});
