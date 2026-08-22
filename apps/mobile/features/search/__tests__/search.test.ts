import type { GoalReadModel, ProjectCardReadModel } from '@ega/api-client';
import type { MobileTaskListItem } from '@/types/tasks';
import {
  normalizeSearchQuery,
  searchWorkspace,
  tokenizeQuery,
} from '../search';

function makeTask(overrides: Partial<MobileTaskListItem> & { title: string }): MobileTaskListItem {
  return {
    id: overrides.id ?? `task-${overrides.title}`,
    title: overrides.title,
    description: overrides.description ?? null,
    blockedReason: null,
    status: overrides.status ?? 'todo',
    priority: overrides.priority ?? 'medium',
    dueDate: null,
    estimateMinutes: null,
    updatedAt: new Date().toISOString(),
    focusRank: null,
    trackedDurationSeconds: 0,
    project: overrides.project ?? { id: 'p1', name: 'Platform', slug: 'platform' },
    goal: overrides.goal ?? null,
    reminders: [],
    recurrence: null,
  } as MobileTaskListItem;
}

function makeProject(overrides: Partial<ProjectCardReadModel> & { name: string }): ProjectCardReadModel {
  const base: ProjectCardReadModel = {
    id: overrides.id ?? `proj-${overrides.name}`,
    name: overrides.name,
    slug: overrides.slug ?? overrides.name.toLowerCase().replaceAll(' ', '-'),
    description: overrides.description ?? null,
    status: overrides.status ?? 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    taskCount: 0,
    completedTaskCount: 0,
    progressPercent: 0,
    statusCounts: [],
    recentTasks: [],
  } as ProjectCardReadModel;

  return { ...base, ...overrides, name: overrides.name };
}

function makeGoal(overrides: Partial<GoalReadModel> & { title: string }): GoalReadModel {
  const base: GoalReadModel = {
    id: overrides.id ?? `goal-${overrides.title}`,
    title: overrides.title,
    description: overrides.description ?? null,
    nextStep: null,
    health: null,
    status: overrides.status ?? 'active',
    updatedAt: new Date().toISOString(),
    projectName: overrides.projectName ?? null,
    linkedTasks: [],
    progressPercent: 0,
  } as GoalReadModel;

  return { ...base, ...overrides, title: overrides.title };
}

describe('normalizeSearchQuery', () => {
  it('trims and lowercases', () => {
    expect(normalizeSearchQuery('  Hello WORLD  ')).toBe('hello world');
  });
});

describe('tokenizeQuery', () => {
  it('splits on whitespace and drops empties', () => {
    expect(tokenizeQuery('  hello   world  ')).toEqual(['hello', 'world']);
  });

  it('returns empty array for blank input', () => {
    expect(tokenizeQuery('   ')).toEqual([]);
  });
});

describe('searchWorkspace', () => {
  const tasks = [
    makeTask({ title: 'Ship mobile search', description: 'Unified search over tasks' }),
    makeTask({ title: 'Fix timer drift', project: { id: 'p2', name: 'Timer', slug: null } }),
    makeTask({
      title: 'Write docs',
      description: 'Architecture decision for auth',
      goal: { id: 'g1', title: 'Quality' },
    }),
  ];

  const projects = [
    makeProject({ name: 'Platform' }),
    makeProject({ name: 'Mobile App', slug: 'mobile-app' }),
  ];

  const goals = [makeGoal({ title: 'Ship search', projectName: 'Mobile App' })];

  it('returns empty results for blank query', () => {
    expect(searchWorkspace({ query: '   ', tasks, projects, goals })).toEqual({
      tasks: [],
      projects: [],
      goals: [],
    });
  });

  it('matches task title case-insensitively', () => {
    const result = searchWorkspace({ query: 'SHIP', tasks, projects, goals });
    expect(result.tasks.map((task) => task.title)).toEqual(['Ship mobile search']);
  });

  it('matches across description and project name', () => {
    const result = searchWorkspace({ query: 'timer', tasks, projects, goals });
    expect(result.tasks.map((task) => task.title)).toContain('Fix timer drift');
  });

  it('requires all tokens to be present (AND semantics)', () => {
    const result = searchWorkspace({ query: 'ship search', tasks, projects, goals });
    expect(result.tasks.map((task) => task.title)).toEqual(['Ship mobile search']);
    expect(searchWorkspace({ query: 'ship drift', tasks, projects, goals }).tasks).toEqual([]);
  });

  it('matches project name and slug', () => {
    const result = searchWorkspace({ query: 'mobile-app', tasks, projects, goals });
    expect(result.projects.map((project) => project.name)).toContain('Mobile App');
  });

  it('matches goal title', () => {
    const result = searchWorkspace({ query: 'ship search', tasks, projects, goals });
    expect(result.goals.map((goal) => goal.title)).toContain('Ship search');
  });

  it('ranks title prefix matches before substring matches', () => {
    const rankedTasks = [
      makeTask({ title: 'Search everywhere' }),
      makeTask({ title: 'Unified search' }),
    ];
    const result = searchWorkspace({
      query: 'search',
      tasks: rankedTasks,
      projects: [],
      goals: [],
    });
    expect(result.tasks[0].title).toBe('Search everywhere');
  });
});
