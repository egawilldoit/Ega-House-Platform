import {
  isGoalArchivedStatus,
  toGoalHealthOrNull,
  type GoalHealth,
  type GoalViewFilter,
} from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import type { GoalRecord, GoalsRepository, GoalTaskContextRecord } from "./ports";

export type GoalReadModel = {
  id: string;
  title: string;
  description: string | null;
  nextStep: string | null;
  health: GoalHealth | null;
  status: string;
  updatedAt: string;
  projectName: string | null;
  linkedTasks: GoalTaskContextRecord[];
  progressPercent: number;
};

export type GoalsReadModel = {
  projects: Array<{ id: string; name: string }>;
  goals: GoalReadModel[];
  summary: {
    total: number;
    active: number;
    completed: number;
    archived: number;
  };
};

export async function getGoalsReadModel(
  actor: AuthenticatedActor,
  repository: GoalsRepository,
  view: GoalViewFilter,
): Promise<ApplicationResult<GoalsReadModel>> {
  const [projectsResult, goalsResult, tasksResult, statusesResult] = await Promise.all([
    repository.listProjectOptions(actor),
    repository.listGoals(actor, view),
    repository.listGoalTasks(actor),
    repository.listGoalStatuses(actor),
  ]);

  if (!projectsResult.ok || !goalsResult.ok || !tasksResult.ok || !statusesResult.ok) {
    return applicationFailure("Unable to load goals right now.");
  }

  const projectNameById = new Map(
    projectsResult.value.map((project) => [project.id, project.name] as const),
  );
  const tasksByGoal = new Map<string, GoalTaskContextRecord[]>();
  for (const task of tasksResult.value) {
    const goalTasks = tasksByGoal.get(task.goalId) ?? [];
    goalTasks.push(task);
    tasksByGoal.set(task.goalId, goalTasks);
  }

  const goals = goalsResult.value.map((goal: GoalRecord) => {
    const linkedTasks = tasksByGoal.get(goal.id) ?? [];
    const completedTasks = linkedTasks.filter((task) => task.status === "done").length;
    return {
      id: goal.id,
      title: goal.title,
      description: goal.description,
      nextStep: goal.nextStep,
      health: toGoalHealthOrNull(goal.health),
      status: goal.status,
      updatedAt: goal.updatedAt,
      projectName: projectNameById.get(goal.projectId) ?? null,
      linkedTasks,
      progressPercent: linkedTasks.length
        ? Math.round((completedTasks / linkedTasks.length) * 100)
        : 0,
    };
  });

  const statuses = statusesResult.value;
  return applicationSuccess({
    projects: projectsResult.value,
    goals,
    summary: {
      total: statuses.length,
      active: statuses.filter((status) => status === "active").length,
      completed: statuses.filter((status) => status === "done").length,
      archived: statuses.filter((status) => isGoalArchivedStatus(status)).length,
    },
  });
}
