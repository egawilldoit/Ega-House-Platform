import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import { useAuth } from '@/lib/auth/auth-context';
import { ensureAndroidChannel } from './channel';
import { getPermissionStatus, type NotificationPermissionStatus } from './permissions';
import { registerCurrentDevice } from './registration';
import { notificationTargetToRoute, parseNotificationPayload } from './target';

type NotificationContextValue = {
  permissionStatus: NotificationPermissionStatus;
  isRegistering: boolean;
  refreshPermission: () => Promise<void>;
  requestPermissionAndRegister: () => Promise<NotificationPermissionStatus>;
  registerIfNeeded: () => Promise<void>;
};

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}

// Foreground behavior: show notification? For task reminders, we want to show even when foregrounded? V1: show alert.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isReady } = useAuth();
  const router = useRouter();
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermissionStatus>('undetermined');
  const [isRegistering, setIsRegistering] = useState(false);
  const hasHandledColdStart = useRef(false);
  const lastHandledNotificationId = useRef<string | null>(null);

  const refreshPermission = useCallback(async () => {
    const status = await getPermissionStatus();
    setPermissionStatus(status);
    return;
  }, []);

  const registerIfNeeded = useCallback(async () => {
    if (!isAuthenticated || !isReady) return;
    const status = await getPermissionStatus();
    setPermissionStatus(status);
    if (status !== 'granted') return;

    // Ensure channel before token
    if (Platform.OS === 'android') {
      await ensureAndroidChannel();
    }

    setIsRegistering(true);
    try {
      await registerCurrentDevice();
    } finally {
      setIsRegistering(false);
    }
  }, [isAuthenticated, isReady]);

  const requestPermissionAndRegister = useCallback(async (): Promise<NotificationPermissionStatus> => {
    const { requestPermission } = await import('./permissions');
    const status = await requestPermission();
    setPermissionStatus(status);
    if (status === 'granted') {
      await registerIfNeeded();
    }
    return status;
  }, [registerIfNeeded]);

  // On auth ready, refresh permission and register if already granted
  useEffect(() => {
    if (!isReady) return;
    refreshPermission();
    if (isAuthenticated) {
      registerIfNeeded();
    }
  }, [isReady, isAuthenticated, refreshPermission, registerIfNeeded]);

  // Listen for token rotation while app runs
  useEffect(() => {
    const subscription = Notifications.addPushTokenListener(async () => {
      if (isAuthenticated && (await getPermissionStatus()) === 'granted') {
        await registerCurrentDevice();
      }
    });
    return () => subscription.remove();
  }, [isAuthenticated]);

  // Foreground notification handling (optional logging)
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener(() => {
      // Foreground: could update unread count via query invalidation later
    });
    return () => sub.remove();
  }, []);

  const handleNotificationResponse = useCallback(
    async (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      const parsed = parseNotificationPayload(data ?? null);
      if (!parsed.notificationId) return;
      // Avoid duplicate navigation from cold-start + listener race
      if (lastHandledNotificationId.current === parsed.notificationId) return;
      lastHandledNotificationId.current = parsed.notificationId;

      // Mark opened/read via API (best effort)
      try {
        const { getMobileEgaApiClient } = await import('@/lib/api/ega');
        const client = getMobileEgaApiClient();
        await client.notifications.markOpened(parsed.notificationId);
      } catch {
        // ignore
      }

      const target = parsed.targetType && parsed.targetId ? { type: parsed.targetType, id: parsed.targetId } : null;
      const route = notificationTargetToRoute(target);
      // Wait a tick for navigation to be ready
      setTimeout(() => {
        try {
          router.push(route.href as never);
        } catch {
          // fallback to notifications screen
          try {
            router.push('/notifications' as never);
          } catch {
            // ignore
          }
        }
      }, 300);
    },
    [router],
  );

  // Response listener
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
    return () => sub.remove();
  }, [handleNotificationResponse]);

  // Cold-start handling
  useEffect(() => {
    if (hasHandledColdStart.current) return;
    hasHandledColdStart.current = true;

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        handleNotificationResponse(response);
      }
    });
  }, [handleNotificationResponse]);

  // AppState: re-check permission/register when returning foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && isAuthenticated) {
        refreshPermission().then(() => registerIfNeeded());
      }
    });
    return () => sub.remove();
  }, [isAuthenticated, refreshPermission, registerIfNeeded]);

  const value: NotificationContextValue = {
    permissionStatus,
    isRegistering,
    refreshPermission,
    requestPermissionAndRegister,
    registerIfNeeded,
  };

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}
