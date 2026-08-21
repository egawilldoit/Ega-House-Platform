/**
 * Parity tests for the canonical Tasks transport adapter (lib/api/tasks.ts).
 * Proves mapTaskApiRecordToViewItem preserves every field of the legacy
 * MobileTaskListItem shape that mobile consumers rely on, and documents the
 * fields that intentionally degrade (project/goal names, trackedDurationSeconds).
 */
import { mapTaskApiRecordToViewItem } from '@/lib/api/tasks';
import type { TaskApiRecord } from '@ega/api-client';

function makeCanonicalRecord(overrides: Partial<TaskApiRecord> = {}): TaskApiRecord {
  return {
    id: 'task-1',
    title: 'Write parity test',
    description: 'Prove adapter parity',
    blockedReason: null,
    status: 'todo',
    priority: 'high',
    dueDate: '2026-08-22',
    estimateMinutes: 45,
    plannedForDate: null,
    projectId: 'project-1',
    goalId: 'goal-1',
    focusRank: 3,
    archivedAt: null,
    scheduledStartAt: null,
    scheduledEndAt: null,
    calendarSyncEnabled: false,
    calendarReminderMinutes: 10,
    completedAt: null,
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-21T09:30:00.000Z',
    reminders: [
      {
        id: 'reminder-1',
        taskId: 'task-1',
        remindAt: '2026-08-22T08:00:00.000Z',
        channel: 'email',
        status: 'pending',
        sentAt: null,
        failureReason: null,
      },
    ],
    recurrence: {
      id: 'recurrence-1',
      taskId: 'task-1',
      rule: 'weekly',
      anchorDate: '2026-08-21',
      timezone: 'UTC',
      nextOccurrenceDate: '2026-08-28',
      lastGeneratedAt: null,
    },
    ...overrides,
  };
}

describe('mapTaskApiRecordToViewItem parity with legacy MobileTaskListItem', () => {
  it('preserves scalar fields consumed by screens and helpers', () => {
    const view = mapTaskApiRecordToViewItem(makeCanonicalRecord());

    expect(view.id).toBe('task-1');
    expect(view.title).toBe('Write parity test');
    expect(view.description).toBe('Prove adapter parity');
    expect(view.blockedReason).toBeNull();
    expect(view.status).toBe('todo');
    expect(view.priority).toBe('high');
    expect(view.dueDate).toBe('2026-08-22');
    expect(view.estimateMinutes).toBe(45);
    expect(view.updatedAt).toBe('2026-08-21T09:30:00.000Z');
    expect(view.focusRank).toBe(3);
  });

  it('maps reminders preserving identity and delivery fields', () => {
    const view = mapTaskApiRecordToViewItem(makeCanonicalRecord());

    expect(view.reminders).toHaveLength(1);
    expect(view.reminders[0]).toMatchObject({
      id: 'reminder-1',
      taskId: 'task-1',
      remindAt: '2026-08-22T08:00:00.000Z',
      channel: 'email',
      status: 'pending',
      sentAt: null,
      failureReason: null,
    });
  });

  it('maps recurrence preserving rule, anchor, timezone and next occurrence', () => {
    const view = mapTaskApiRecordToViewItem(makeCanonicalRecord());

    expect(view.recurrence).toMatchObject({
      rule: 'weekly',
      anchorDate: '2026-08-21',
      timezone: 'UTC',
      nextOccurrenceDate: '2026-08-28',
    });
  });

  it('degrades project/goal to id-only references without inventing names', () => {
    const view = mapTaskApiRecordToViewItem(makeCanonicalRecord());

    expect(view.project).toEqual({ id: 'project-1' });
    expect(view.project.name).toBeUndefined();
    expect(view.goal).toEqual({ id: 'goal-1' });
    expect(view.goal?.title).toBeUndefined();
  });

  it('returns null goal when canonical record has no goalId', () => {
    const view = mapTaskApiRecordToViewItem(makeCanonicalRecord({ goalId: null }));

    expect(view.goal).toBeNull();
  });

  it('does not fabricate trackedDurationSeconds (intentional degradation)', () => {
    const view = mapTaskApiRecordToViewItem(makeCanonicalRecord()) as Record<string, unknown>;

    expect(Object.prototype.hasOwnProperty.call(view, 'trackedDurationSeconds')).toBe(false);
  });
});
