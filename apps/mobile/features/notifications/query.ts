import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchNotifications,
  fetchUnreadCount,
  fetchNotificationPreferences,
  markAllNotificationsRead,
  markNotificationOpened,
  markNotificationRead,
  updateNotificationPreference,
} from '@/lib/api/notifications';

export const notificationQueryKeys = {
  all: ['notifications'] as const,
  list: () => ['notifications', 'list'] as const,
  unread: () => ['notifications', 'unread'] as const,
  preferences: () => ['notifications', 'preferences'] as const,
};

export function useNotificationsQuery() {
  return useQuery({
    queryKey: notificationQueryKeys.list(),
    queryFn: () => fetchNotifications({ limit: 50 }),
    staleTime: 30_000,
  });
}

export function useUnreadCountQuery() {
  return useQuery({
    queryKey: notificationQueryKeys.unread(),
    queryFn: fetchUnreadCount,
    staleTime: 15_000,
  });
}

export function useMarkReadMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => markNotificationRead(notificationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationQueryKeys.all });
    },
  });
}

export function useMarkOpenedMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => markNotificationOpened(notificationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationQueryKeys.all });
    },
  });
}

export function useMarkAllReadMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationQueryKeys.all });
    },
  });
}

export function useNotificationPreferencesQuery() {
  return useQuery({
    queryKey: notificationQueryKeys.preferences(),
    queryFn: fetchNotificationPreferences,
  });
}

export function useUpdatePreferenceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { notificationType: 'task_reminder'; pushEnabled?: boolean; emailEnabled?: boolean }) =>
      updateNotificationPreference(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationQueryKeys.preferences() });
    },
  });
}
