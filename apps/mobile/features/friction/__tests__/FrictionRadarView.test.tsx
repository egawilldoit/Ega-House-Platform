import * as React from 'react';
import { act, create } from 'react-test-renderer';

import { FrictionRadarView } from '../FrictionRadarView';

jest.mock('@expo/vector-icons/Ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

const baseProps = {
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
  staleGoals: [
    {
      id: 'goal-1',
      title: 'Ship the release',
      ageDays: 8,
      updatedAt: '2026-08-26T00:00:00.000Z',
      status: 'active',
      projectId: 'project-1',
    },
  ],
  thresholdDays: 7,
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

describe('FrictionRadarView', () => {
  it('makes task and goal signals open their canonical details', () => {
    const onTaskPress = jest.fn();
    const onGoalPress = jest.fn();
    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = create(
        <FrictionRadarView
          {...baseProps}
          onTaskPress={onTaskPress}
          onGoalPress={onGoalPress}
        />,
      );
    });

    const taskRow = renderer!.root.find(
      (node) =>
        node.props.accessibilityLabel === 'Open blocked task: Unblock the release' &&
        node.props.accessibilityRole === 'button',
    );
    const goalRow = renderer!.root.find(
      (node) =>
        node.props.accessibilityLabel === 'Open stale goal: Ship the release' &&
        node.props.accessibilityRole === 'button',
    );

    expect(taskRow).toBeDefined();
    expect(taskRow?.props.accessibilityRole).toBe('button');
    expect(goalRow).toBeDefined();

    act(() => {
      taskRow?.props.onPress();
      goalRow?.props.onPress();
    });

    expect(onTaskPress).toHaveBeenCalledWith('task-1');
    expect(onGoalPress).toHaveBeenCalledWith('goal-1');
  });
});
