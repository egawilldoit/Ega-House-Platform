import type { GoalReadModel, ProjectCardReadModel } from '@ega/api-client';
import type { MobileTaskListItem } from '@/types/tasks';

export type SearchableTask = Pick<
  MobileTaskListItem,
  'id' | 'title' | 'description' | 'status' | 'priority' | 'project' | 'goal'
>;

export type SearchResults = {
  tasks: SearchableTask[];
  projects: ProjectCardReadModel[];
  goals: GoalReadModel[];
};

export function normalizeSearchQuery(value: string): string {
  return value.trim().toLowerCase();
}

export function tokenizeQuery(value: string): string[] {
  const normalized = normalizeSearchQuery(value);
  if (!normalized) {
    return [];
  }

  return normalized.split(/\s+/).filter(Boolean);
}

function buildTaskHaystack(task: SearchableTask): string {
  return [
    task.title,
    task.description ?? '',
    task.project.name,
    task.goal?.title ?? '',
    task.status,
    task.priority,
  ]
    .join(' ')
    .toLowerCase();
}

function buildProjectHaystack(project: ProjectCardReadModel): string {
  return [project.name, project.slug, project.description ?? '', project.status]
    .join(' ')
    .toLowerCase();
}

function buildGoalHaystack(goal: GoalReadModel): string {
  return [
    goal.title,
    goal.description ?? '',
    goal.projectName ?? '',
    goal.status,
    goal.health ?? '',
  ]
    .join(' ')
    .toLowerCase();
}

function matchesAllTokens(haystack: string, tokens: string[]): boolean {
  return tokens.every((token) => haystack.includes(token));
}

function scoreTaskMatch(task: SearchableTask, normalizedQuery: string): number {
  const titleLower = task.title.toLowerCase();
  if (titleLower.startsWith(normalizedQuery)) {
    return 2;
  }

  if (titleLower.includes(normalizedQuery)) {
    return 1;
  }

  return 0;
}

function scoreProjectMatch(project: ProjectCardReadModel, normalizedQuery: string): number {
  const nameLower = project.name.toLowerCase();
  if (nameLower.startsWith(normalizedQuery)) {
    return 2;
  }

  if (nameLower.includes(normalizedQuery)) {
    return 1;
  }

  return 0;
}

function scoreGoalMatch(goal: GoalReadModel, normalizedQuery: string): number {
  const titleLower = goal.title.toLowerCase();
  if (titleLower.startsWith(normalizedQuery)) {
    return 2;
  }

  if (titleLower.includes(normalizedQuery)) {
    return 1;
  }

  return 0;
}

export function searchWorkspace(input: {
  query: string;
  tasks: SearchableTask[];
  projects: ProjectCardReadModel[];
  goals: GoalReadModel[];
}): SearchResults {
  const tokens = tokenizeQuery(input.query);
  const normalized = normalizeSearchQuery(input.query);

  if (tokens.length === 0) {
    return { tasks: [], projects: [], goals: [] };
  }

  const matchedTasks = input.tasks
    .filter((task) => matchesAllTokens(buildTaskHaystack(task), tokens))
    .map((task) => ({ task, score: scoreTaskMatch(task, normalized) }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.task);

  const matchedProjects = input.projects
    .filter((project) => matchesAllTokens(buildProjectHaystack(project), tokens))
    .map((project) => ({ project, score: scoreProjectMatch(project, normalized) }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.project);

  const matchedGoals = input.goals
    .filter((goal) => matchesAllTokens(buildGoalHaystack(goal), tokens))
    .map((goal) => ({ goal, score: scoreGoalMatch(goal, normalized) }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.goal);

  return { tasks: matchedTasks, projects: matchedProjects, goals: matchedGoals };
}
