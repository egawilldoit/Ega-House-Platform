import { notificationTargetToRoute, parseNotificationPayload } from '../target';

describe('notificationTargetToRoute', () => {
  it('maps task target to task detail route', () => {
    const route = notificationTargetToRoute({ type: 'task', id: '123-abc' });
    expect(route).toEqual({ type: 'task', id: '123-abc', href: '/tasks/123-abc' });
  });

  it('maps existing timer, review and today targets', () => {
    expect(notificationTargetToRoute({ type: 'timer', id: null })).toEqual({
      type: 'timer',
      href: '/timer',
    });
    expect(notificationTargetToRoute({ type: 'review', id: null })).toEqual({
      type: 'review',
      href: '/review',
    });
    expect(notificationTargetToRoute({ type: 'today', id: null })).toEqual({
      type: 'today',
      href: '/today',
    });
  });

  it('falls back to notifications for null target', () => {
    expect(notificationTargetToRoute(null)).toEqual({ type: 'fallback', href: '/notifications' });
    expect(notificationTargetToRoute(undefined)).toEqual({ type: 'fallback', href: '/notifications' });
  });

  it('falls back for unknown target type', () => {
    expect(notificationTargetToRoute({ type: 'goal' as never, id: 'g1' })).toEqual({ type: 'fallback', href: '/notifications' });
  });

  it('falls back for routine and money until their cards exist', () => {
    expect(notificationTargetToRoute({ type: 'routine', id: 'r1' })).toEqual({ type: 'fallback', href: '/notifications' });
    expect(notificationTargetToRoute({ type: 'money', id: 'm1' })).toEqual({ type: 'fallback', href: '/notifications' });
  });

  it('falls back for empty id', () => {
    expect(notificationTargetToRoute({ type: 'task', id: ' ' })).toEqual({ type: 'fallback', href: '/notifications' });
    expect(notificationTargetToRoute({ type: 'task', id: null })).toEqual({ type: 'fallback', href: '/notifications' });
  });

  it('parses payload correctly and handles missing fields', () => {
    expect(parseNotificationPayload({ notificationId: 'n1', type: 'task_reminder', targetType: 'task', targetId: 't1' })).toEqual({
      notificationId: 'n1',
      type: 'task_reminder',
      targetType: 'task',
      targetId: 't1',
    });

    expect(parseNotificationPayload(null)).toEqual({ notificationId: null, type: null, targetType: null, targetId: null });
    expect(parseNotificationPayload({} as never)).toEqual({ notificationId: null, type: null, targetType: null, targetId: null });
  });
});
