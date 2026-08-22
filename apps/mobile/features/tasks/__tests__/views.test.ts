import { getTaskViewPreset, matchTaskViewPreset, TASK_VIEW_PRESETS } from '../views';

describe('TASK_VIEW_PRESETS', () => {
  it('contains unique ids and labels', () => {
    const ids = TASK_VIEW_PRESETS.map((preset) => preset.id);
    const labels = TASK_VIEW_PRESETS.map((preset) => preset.label);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('uses only server-validated due filters, sort values, statuses, and priorities', () => {
    const dueFilters = ['all', 'overdue', 'due_today', 'due_soon', 'no_due_date'];
    const sortValues = ['updated_desc', 'due_date_asc', 'due_date_desc'];
    const priorities = ['all', 'low', 'medium', 'high', 'urgent'];

    for (const preset of TASK_VIEW_PRESETS) {
      expect(dueFilters).toContain(preset.due);
      expect(sortValues).toContain(preset.sort);
      expect(['all', 'todo', 'in_progress', 'done', 'blocked']).toContain(preset.status);
      expect(priorities).toContain(preset.priority);
    }
  });

  it('exposes an urgent preset backed by canonical priority filtering', () => {
    expect(getTaskViewPreset('urgent')).toMatchObject({
      id: 'urgent',
      label: 'Urgent',
      status: 'all',
      priority: 'urgent',
      due: 'all',
      sort: 'updated_desc',
    });
  });
});

describe('matchTaskViewPreset', () => {
  it('matches each preset by its own state', () => {
    for (const preset of TASK_VIEW_PRESETS) {
      expect(
        matchTaskViewPreset({
          status: preset.status,
          priority: preset.priority,
          due: preset.due,
          sort: preset.sort,
        }),
      ).toBe(preset.id);
    }
  });

  it('returns null for custom combinations outside every preset', () => {
    expect(
      matchTaskViewPreset({
        status: 'in_progress',
        priority: 'all',
        due: 'due_soon',
        sort: 'due_date_desc',
      }),
    ).toBeNull();
  });

  it('does not confuse due_today and overdue presets', () => {
    expect(
      matchTaskViewPreset({
        status: 'all',
        priority: 'all',
        due: 'due_today',
        sort: 'due_date_asc',
      }),
    ).toBe('today');
    expect(
      matchTaskViewPreset({
        status: 'all',
        priority: 'all',
        due: 'overdue',
        sort: 'due_date_asc',
      }),
    ).toBe('overdue');
  });

  it('distinguishes urgent from all even when other filters match', () => {
    expect(
      matchTaskViewPreset({
        status: 'all',
        priority: 'urgent',
        due: 'all',
        sort: 'updated_desc',
      }),
    ).toBe('urgent');
    expect(
      matchTaskViewPreset({
        status: 'all',
        priority: 'high',
        due: 'all',
        sort: 'updated_desc',
      }),
    ).toBeNull();
  });
});
