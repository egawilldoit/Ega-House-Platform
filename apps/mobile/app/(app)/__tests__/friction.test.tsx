import * as React from 'react';
import { act, create } from 'react-test-renderer';
import { useRouter } from 'expo-router';

import FrictionRadarScreen from '../friction';
import { useFrictionRadarQuery } from '@/features/friction/query';

jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
}));

jest.mock('@/components/mobile/navigation/bottomChrome', () => ({
  useBottomChromeMetrics: () => ({ contentBottomPaddingNoFab: 0 }),
}));

jest.mock('@expo/vector-icons/Ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/features/friction/query', () => ({
  useFrictionRadarQuery: jest.fn(),
}));

const response = {
  ok: true as const,
  generatedAt: '2026-09-03T00:00:00.000Z',
  thresholdDays: 7,
  blocked: [
    {
      id: 'task-1',
      title: 'Unblock the release',
      blockedReason: 'Waiting on review',
      ageDays: 3,
      updatedAt: '2026-08-31T00:00:00.000Z',
      projectId: 'project-1',
      goalId: null,
      status: 'blocked',
    },
  ],
  staleTasks: [],
  staleGoals: [],
  estimateSignals: [],
  contextSwitch: {
    switchCount: 0,
    threshold: 6,
    highThreshold: 10,
    severity: 'none' as const,
    isFriction: false,
    transitionsCount: 0,
    distinctTaskCount: 0,
    window: { startIso: '2026-08-25T00:00:00.000Z', endIso: '2026-09-01T00:00:00.000Z' },
  },
  neglectedGoals: [],
  workloadImbalance: {
    isImbalance: false,
    severity: 'none' as const,
    totalTrackedSeconds: 0,
    totalTrackedMinutes: 0,
    projectCount: 0,
    dominantProjectId: null,
    dominantProjectName: null,
    dominantTrackedSeconds: 0,
    dominantSharePercent: 0,
    threshold: 60,
    highThreshold: 75,
    minTotalMinutes: 120,
    minForHighMinutes: 240,
    window: { startIso: '2026-08-25T00:00:00.000Z', endIso: '2026-09-01T00:00:00.000Z' },
  },
  evidenceWindow: null,
};

describe('FrictionRadarScreen', () => {
  it('routes an actionable signal to the existing task detail screen', () => {
    const push = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ push });
    (useFrictionRadarQuery as jest.Mock).mockReturnValue({
      data: response,
      error: null,
      isError: false,
      isFetched: true,
      isPending: false,
      isRefetching: false,
      refetch: jest.fn().mockResolvedValue(undefined),
    });

    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<FrictionRadarScreen />);
    });

    const taskRow = renderer!.root.find(
      (node) =>
        node.props.accessibilityLabel === 'Open blocked task: Unblock the release' &&
        node.props.accessibilityRole === 'button',
    );

    act(() => {
      taskRow.props.onPress();
    });

    expect(push).toHaveBeenCalledWith({
      pathname: '/(app)/tasks/[id]',
      params: { id: 'task-1' },
    });
  });
});
