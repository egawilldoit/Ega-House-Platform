export type NotificationTarget = {
  type: string;
  id: string | null;
};

export type MobileRoute =
  | { type: 'task'; id: string; href: `/tasks/${string}` }
  | { type: 'timer'; href: '/timer' }
  | { type: 'review'; href: '/review' }
  | { type: 'today'; href: '/today' }
  | { type: 'fallback'; href: '/notifications' };

/**
 * Maps a semantic notification target to an Expo Router route.
 * Never persists raw router paths in backend; backend stores typed target.
 * Unknown/unsupported targets fall back to the notification center.
 */
export function notificationTargetToRoute(target: NotificationTarget | null | undefined): MobileRoute {
  if (!target || !target.type) {
    return { type: 'fallback', href: '/notifications' };
  }

  switch (target.type) {
    case 'task': {
      const id = typeof target.id === 'string' ? target.id.trim() : '';
      if (!id) return { type: 'fallback', href: '/notifications' };
      return { type: 'task', id, href: `/tasks/${id}` };
    }
    case 'timer':
      return { type: 'timer', href: '/timer' };
    case 'review':
      return { type: 'review', href: '/review' };
    case 'today':
      return { type: 'today', href: '/today' };
    case 'routine':
    case 'money':
    default:
      // Dedicated routine/money cards are not available on this baseline.
      return { type: 'fallback', href: '/notifications' };
  }
}

export function parseNotificationPayload(data: Record<string, unknown> | null | undefined): {
  notificationId: string | null;
  type: string | null;
  targetType: string | null;
  targetId: string | null;
} {
  if (!data || typeof data !== 'object') {
    return { notificationId: null, type: null, targetType: null, targetId: null };
  }

  const notificationId = typeof data.notificationId === 'string' ? data.notificationId : null;
  const type = typeof data.type === 'string' ? data.type : null;
  const targetType = typeof data.targetType === 'string' ? data.targetType : null;
  const targetId = typeof data.targetId === 'string' ? data.targetId : null;

  return { notificationId, type, targetType, targetId };
}
