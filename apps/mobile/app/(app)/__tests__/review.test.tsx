import * as React from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { StyleSheet } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';
import { useWeeklyReviewQuery } from '@/features/weekly-review/query';

import WeeklyReviewScreen from '../review';

jest.mock('expo-router', () => ({
  Stack: Object.assign(
    ({ children }: { children?: React.ReactNode }) => children ?? null,
    { Screen: () => null },
  ),
}));

jest.mock('@/features/weekly-review/query', () => ({
  useWeeklyReviewQuery: jest.fn(),
}));

const response = {
  review: {
    window: {
      weekStart: '2026-08-31',
      weekEnd: '2026-09-06',
      timezone: 'UTC',
      fallback: 'none',
    },
    stats: {
      tasksCreated: 3,
      sessionsLogged: 2,
      trackedSeconds: 7_200,
      goalsTouched: 1,
      blockedTasks: [],
    },
    savedReview: null,
    generatedDraft: {
      summary: 'A focused week.',
      wins: 'Kept momentum.',
      blockers: 'None.',
      nextSteps: 'Continue.',
    },
    mostTracked: { tasks: [], projects: [], goals: [] },
  },
};

const queryResult = {
  data: response,
  isLoading: false,
  isError: false,
  error: null,
  refetch: jest.fn(),
  isFetching: false,
};

function flattenPressableStyle(node: ReactTestInstance) {
  const style = typeof node.props.style === 'function'
    ? node.props.style({ pressed: false })
    : node.props.style;
  return StyleSheet.flatten(style);
}

describe('WeeklyReviewScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useWeeklyReviewQuery as jest.Mock).mockReturnValue(queryResult);
  });

  it('gives week navigation and current-week actions accessible 44dp targets', () => {
    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = create(<WeeklyReviewScreen />);
    });

    const previous = renderer!.root.findByProps({ testID: 'review-previous-week' });
    const next = renderer!.root.findByProps({ testID: 'review-next-week' });
    const current = renderer!.root.findByProps({ testID: 'review-current-week' });

    expect(previous.props.accessibilityRole).toBe('button');
    expect(previous.props.accessibilityLabel).toBe('View previous week');
    expect(flattenPressableStyle(previous).minHeight).toBeGreaterThanOrEqual(
      mobileTheme.layout.minTouchTarget,
    );
    expect(next.props.accessibilityRole).toBe('button');
    expect(next.props.accessibilityLabel).toBe('View next week');
    expect(flattenPressableStyle(next).minHeight).toBeGreaterThanOrEqual(
      mobileTheme.layout.minTouchTarget,
    );
    expect(current.props.accessibilityRole).toBe('button');
    expect(current.props.accessibilityLabel).toBe('Return to this week');
    expect(flattenPressableStyle(current).minHeight).toBeGreaterThanOrEqual(
      mobileTheme.layout.minTouchTarget,
    );
  });

  it('makes a failed review load recoverable with an accessible retry action', () => {
    const refetch = jest.fn();
    (useWeeklyReviewQuery as jest.Mock).mockReturnValue({
      ...queryResult,
      data: undefined,
      error: new Error('offline'),
      isError: true,
      refetch,
    });

    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<WeeklyReviewScreen />);
    });

    const retry = renderer!.root.findByProps({ testID: 'review-retry' });
    expect(retry.props.accessibilityRole).toBe('button');
    expect(retry.props.accessibilityLabel).toBe('Retry loading weekly review');
    expect(flattenPressableStyle(retry).minHeight).toBeGreaterThanOrEqual(
      mobileTheme.layout.minTouchTarget,
    );

    act(() => {
      retry.props.onPress();
    });

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
