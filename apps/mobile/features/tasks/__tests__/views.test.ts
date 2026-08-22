import { matchTaskViewPreset, TASK_VIEW_PRESETS } from '../views';

describe('TASK_VIEW_PRESETS', () => {
  it('contains unique ids and labels', () => {
    const ids = TASK_VIEW_PRESETS.map((preset) => preset.id);
    const labels = TASK_VIEW_PRESETS.map((preset) => preset.label);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('uses only server-validated due filters and sort values', () => {
    const dueFilters = ['all', 'overdue', 'due_today', 'due_soon', 'no_due_date'];
    const sortValues = ['updated_desc', 'due_date_asc', 'due_date_desc'];

    for (const preset of TASK_VIEW_PRESETS) {
      expect(dueFilters).toContain(preset.due);
      expect(sortValues).toContain(preset.sort);
      expect(['all', 'todo', 'in_progress', 'done', 'blocked']).toContain(preset.status);
    }
  });
});

describe('matchTaskViewPreset', () => {
  it('matches each preset by its own state', () => {
    for (const preset of TASK_VIEW_PRESETS) {
      expect(
        matchTaskViewPreset({ status: preset.status, due: preset.due, sort: preset.sort }),
      ).toBe(preset.id);
    }
  });

  it('returns null for custom combinations outside every preset', () => {
    expect(
      matchTaskViewPreset({ status: 'in_progress', due: 'due_soon', sort: 'due_date_desc' }),
    ).toBeNull();
  });

  it('does not confuse due_today and overdue presets', () => {
    expect(matchTaskViewPreset({ status: 'all', due: 'due_today', sort: 'due_date_asc' })).toBe(
      'today',
    );
    expect(matchTaskViewPreset({ status: 'all', due: 'overdue', sort: 'due_date_asc' })).toBe(
      'overdue',
    );
  });
});
