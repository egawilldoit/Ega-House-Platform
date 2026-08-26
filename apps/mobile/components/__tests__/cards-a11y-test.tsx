import * as React from 'react';
import { StyleSheet, type StyleProp } from 'react-native';
import { act, create, type ReactTestRendererJSON } from 'react-test-renderer';

import type { GoalReadModel, ProjectCardReadModel } from '@ega/api-client';
import { GoalCard } from '@/features/goals/components/GoalCard';
import { ProjectCard } from '@/features/projects/components/ProjectCard';
import { TaskCard } from '@/features/tasks/components/TaskCard';
import { TodayTaskCard } from '@/features/today/components/TodayTaskCard';

jest.mock('@expo/vector-icons/Ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

const GOAL: GoalReadModel = {
  id: 'g-1',
  title: 'Ship the mobile dashboard',
  description: null,
  nextStep: null,
  health: 'on_track',
  status: 'active',
  updatedAt: '2026-01-02T00:00:00.000Z',
  projectName: 'Launch the Platform',
  linkedTasks: [],
  progressPercent: 0,
};

const PROJECT: ProjectCardReadModel = {
  id: 'p-1',
  name: 'Launch the Platform',
  slug: 'launch-the-platform',
  description: null,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  taskCount: 4,
  completedTaskCount: 1,
  progressPercent: 25,
  statusCounts: [],
  recentTasks: [],
};

type A11yNode = ReactTestRendererJSON;

function collectNodes(json: ReactTestRendererJSON | ReactTestRendererJSON[] | null): A11yNode[] {
  const roots =
    json === null ? [] : Array.isArray(json) ? ([...json] as A11yNode[]) : [json as A11yNode];
  const nodes: A11yNode[] = [];

  const visit = (node: A11yNode) => {
    nodes.push(node);
    for (const child of node.children ?? []) {
      if (typeof child !== 'string') {
        visit(child);
      }
    }
  };

  roots.forEach(visit);

  return nodes;
}

function renderTree(element: React.ReactElement): A11yNode[] {
  let component: ReturnType<typeof create> | undefined;

  act(() => {
    component = create(element);
  });

  return collectNodes(component!.toJSON());
}

function flattenStyle(style: unknown): Record<string, unknown> {
  return (StyleSheet.flatten(style as StyleProp<unknown>) ?? {}) as Record<string, unknown>;
}

describe('card accessibility', () => {
  it('TaskCard main tap area is a button and the actions icon button is 44x44', () => {
    const nodes = renderTree(
      <TaskCard
        dueLabel="No due date"
        onActions={() => undefined}
        onOpen={() => undefined}
        priority="high"
        project="Platform"
        status="todo"
        title="Write audit report"
      />,
    );

    const mainTap = nodes.find(
      (node) =>
        node.props.accessibilityRole === 'button' &&
        node.props.accessibilityLabel === 'Write audit report' &&
        node.props.accessibilityHint === 'Open details' &&
        Number(flattenStyle(node.props.style).borderRadius) === 10,
    );
    expect(mainTap).toBeDefined();

    const iconAction = nodes.find(
      (node) => node.props.accessibilityLabel === 'Open task actions',
    );
    expect(iconAction?.props.accessibilityRole).toBe('button');
    expect(flattenStyle(iconAction?.props.style).height).toBe(44);
    expect(flattenStyle(iconAction?.props.style).width).toBe(44);
  });

  it('GoalCard main tap is a button and action target meets 44 without hit slop', () => {
    const nodes = renderTree(<GoalCard goal={GOAL} onPress={() => undefined} onActions={() => undefined} />);

    const mainTap = nodes.find((node) => node.props.accessibilityRole === 'button');
    expect(mainTap?.props.focusable).toBe(true);

    const actionsButton = nodes.find(
      (node) => node.props.accessibilityLabel === 'Goal actions',
    );
    expect(actionsButton?.props.hitSlop).toBeUndefined();
    expect(flattenStyle(actionsButton?.props.style).width).toBe(44);
    expect(flattenStyle(actionsButton?.props.style).height).toBe(44);
  });

  it('ProjectCard action button meets the 44 target without relying on hit slop', () => {
    const nodes = renderTree(
      <ProjectCard onActions={() => undefined} onOpen={() => undefined} project={PROJECT} />,
    );

    const actionsButton = nodes.find(
      (node) => node.props.accessibilityLabel === 'Project actions',
    );
    expect(flattenStyle(actionsButton?.props.style).width).toBe(44);
    expect(flattenStyle(actionsButton?.props.style).height).toBe(44);
    expect(actionsButton?.props.hitSlop).toBeUndefined();
  });

  it('TodayTaskCard ghost actions button has an accessible name and 44 target', () => {
    const nodes = renderTree(
      <TodayTaskCard
        busy={false}
        dueLabel="Due today"
        muted={false}
        onActions={() => undefined}
        onOpen={() => undefined}
        onPrimaryAction={() => undefined}
        primaryActionLabel="Start"
        priority="high"
        project="Platform"
        status="todo"
        title="Draft launch brief"
      />,
    );

    const ghostActions = nodes.find(
      (node) => node.props.accessibilityLabel === 'Open task actions',
    );

    expect(ghostActions?.props.accessibilityRole).toBe('button');
    expect(flattenStyle(ghostActions?.props.style).minHeight).toBe(44);
    expect(flattenStyle(ghostActions?.props.style).width).toBe(44);
  });
});
