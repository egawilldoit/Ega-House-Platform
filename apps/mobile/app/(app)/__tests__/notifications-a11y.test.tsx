import * as React from 'react';
import { act, create } from 'react-test-renderer';

import NotificationsScreen from '../notifications';
import {
  useMarkAllReadMutation,
  useMarkOpenedMutation,
  useNotificationsQuery,
} from '@/features/notifications/query';

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ push: jest.fn() })),
}));

jest.mock('@expo/vector-icons/Ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/features/notifications/query', () => ({
  useMarkAllReadMutation: jest.fn(),
  useMarkOpenedMutation: jest.fn(),
  useNotificationsQuery: jest.fn(),
}));

const notification = {
  id: 'notification-1',
  type: 'task_reminder' as const,
  title: 'Build report',
  body: 'Your task is due.',
  target: { type: 'task' as const, id: 'task-1' },
  readAt: null,
  openedAt: null,
  createdAt: '2026-09-03T12:00:00.000Z',
  updatedAt: '2026-09-03T12:00:00.000Z',
};

describe('NotificationsScreen accessibility', () => {
  beforeEach(() => {
    (useNotificationsQuery as jest.Mock).mockReturnValue({
      data: { notifications: [notification] },
      isError: false,
      isPending: false,
      isRefetching: false,
      refetch: jest.fn(),
    });
    (useMarkOpenedMutation as jest.Mock).mockReturnValue({
      mutateAsync: jest.fn().mockResolvedValue(undefined),
    });
    (useMarkAllReadMutation as jest.Mock).mockReturnValue({
      mutateAsync: jest.fn().mockResolvedValue(undefined),
    });
  });

  it('names notification rows and exposes unread state without relying on color', () => {
    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = create(<NotificationsScreen />);
    });

    const notificationRow = renderer!.root.findByProps({
      accessibilityLabel: 'Open unread notification: Build report',
    });

    expect(notificationRow.props.accessibilityRole).toBe('button');
    expect(notificationRow.props.accessibilityHint).toBe('Opens the related item');
  });
});
