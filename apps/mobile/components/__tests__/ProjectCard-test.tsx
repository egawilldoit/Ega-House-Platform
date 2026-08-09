import * as React from 'react';
import { act, create } from 'react-test-renderer';

import type { ProjectCardReadModel } from '@ega/api-client';
import { ProjectCard } from '../mobile/ProjectCard';

jest.mock('@expo/vector-icons/Ionicons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) =>
      React.createElement(Text, props, 'icon'),
  };
});

const PROJECT: ProjectCardReadModel = {
  id: 'p-1',
  name: 'Launch the Platform',
  slug: 'launch-the-platform',
  description: 'Get the platform out the door',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  taskCount: 4,
  completedTaskCount: 1,
  progressPercent: 25,
  statusCounts: [{ status: 'done', count: 1 }],
  recentTasks: [],
};

function renderCard(overrides: Partial<ProjectCardReadModel> = {}) {
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(
      <ProjectCard
        project={{ ...PROJECT, ...overrides }}
        onActions={() => undefined}
        onOpen={() => undefined}
      />,
    );
  });

  return tree!;
}

function findText(component: ReturnType<typeof create>, text: string) {
  const json = component.toJSON();
  if (!json) {
    return false;
  }
  return JSON.stringify(json).includes(text);
}

describe('ProjectCard', () => {
  it('renders the project name, description, and progress', () => {
    const component = renderCard();

    expect(findText(component, 'Launch the Platform')).toBe(true);
    expect(findText(component, 'Get the platform out the door')).toBe(true);
    expect(findText(component, '1 / 4 tasks')).toBe(true);
  });

  it('renders the normalized status label', () => {
    const component = renderCard({ status: 'paused' });

    expect(findText(component, 'paused')).toBe(true);
  });

  it('marks archived projects with the archived status', () => {
    const component = renderCard({ status: 'archived' });

    expect(findText(component, 'archived')).toBe(true);
  });

  it('hides the description when absent', () => {
    const component = renderCard({ description: null });

    expect(findText(component, 'Get the platform out the door')).toBe(false);
  });
});
