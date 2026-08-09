import * as React from 'react';
import { act, create } from 'react-test-renderer';

import type { GoalReadModel } from '@ega/api-client';
import { GoalCard } from '../mobile/GoalCard';

jest.mock('@expo/vector-icons/Ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

const GOAL: GoalReadModel = {
  id: 'g-1',
  title: 'Ship the mobile dashboard',
  description: 'A clear read on the business from your pocket',
  nextStep: 'Draft the dashboard spec',
  health: 'on_track',
  status: 'active',
  updatedAt: '2026-01-02T00:00:00.000Z',
  projectName: 'Launch the Platform',
  linkedTasks: [
    { id: 't-1', title: 'Design empty states', status: 'todo', goalId: 'g-1' },
    { id: 't-2', title: 'Build chart cards', status: 'done', goalId: 'g-1' },
  ],
  progressPercent: 50,
};

function renderCard(overrides: Partial<GoalReadModel> = {}) {
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(<GoalCard goal={{ ...GOAL, ...overrides }} onActions={() => undefined} />);
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

describe('GoalCard', () => {
  it('renders the goal title, project, and next step', () => {
    const component = renderCard();

    expect(findText(component, 'Ship the mobile dashboard')).toBe(true);
    expect(findText(component, 'LAUNCH THE PLATFORM')).toBe(true);
    expect(findText(component, 'Draft the dashboard spec')).toBe(true);
  });

  it('renders health and status labels', () => {
    const component = renderCard();

    expect(findText(component, 'on track')).toBe(true);
    expect(findText(component, 'active')).toBe(true);
  });

  it('shows the linked task count and progress', () => {
    const component = renderCard();

    expect(findText(component, '50%')).toBe(true);
    expect(findText(component, '2 tasks')).toBe(true);
  });

  it('omits the next step row when absent', () => {
    const component = renderCard({ nextStep: null });

    expect(findText(component, 'Draft the dashboard spec')).toBe(false);
  });
});
