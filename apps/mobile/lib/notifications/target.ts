export type NotificationTarget = {
  type: string;
  id: string;
};

export type MobileRoute =
  | { type: 'task'; id: string; href: `/tasks/${string}` }
  | { type: 'fallback'; href: '/notifications' };

/**
 * Maps a semantic notification target to an Expo Router route.
 * Never persists raw router paths in backend; backend stores typed target.
 */
export function notificationTargetToRoute(target: NotificationTarget | null | undefined): MobileRoute {
  if (!target || !target.type || !target.id) {
    return { type: 'fallback', href: '/notifications' };
  }

  if (target.type === 'task' && isUuidLike(target.id)) {
    return { type: 'task', id: target.id, href: `/tasks/${target.id}` };
  }

  // Unknown target: safe fallback
  return { type: 'fallback', href: '/notifications' };
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

function isUuidLike(value: string): boolean {
  // Loose check: non-empty string, allow any task id format (uuid or legacy)
  return value.trim().length > 0;
}
