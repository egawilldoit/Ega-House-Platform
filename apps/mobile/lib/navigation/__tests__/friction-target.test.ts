import { frictionTargetToRoute } from '../friction-target';

describe('frictionTargetToRoute', () => {
  it('maps task signals to task detail', () => {
    expect(frictionTargetToRoute({ type: 'task', id: 'task-1' })).toEqual({
      type: 'task',
      pathname: '/(app)/tasks/[id]',
      params: { id: 'task-1' },
    });
  });

  it('maps goal signals to goal detail', () => {
    expect(frictionTargetToRoute({ type: 'goal', id: 'goal-1' })).toEqual({
      type: 'goal',
      pathname: '/(app)/goals/[id]',
      params: { id: 'goal-1' },
    });
  });

  it.each([
    null,
    undefined,
    { type: 'task', id: ' ' },
    { type: 'unknown', id: 'task-1' },
  ])('returns no route for an invalid target: %p', (target) => {
    expect(frictionTargetToRoute(target as never)).toBeNull();
  });
});
