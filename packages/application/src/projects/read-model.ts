import {
  isProjectArchivedStatus,
  type ProjectViewFilter,
} from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import type {
  ProjectGoalRecord,
  ProjectRecord,
  ProjectsRepository,
  ProjectTaskContextRecord,
} from "./ports";

export type ProjectCardReadModel = ProjectRecord & {
  taskCount: number;
  completedTaskCount: number;
  progressPercent: number;
  statusCounts: Array<{ status: string; count: number }>;
  recentTasks: ProjectTaskContextRecord[];
};

export type ProjectsReadModel = {
  projects: ProjectCardReadModel[];
  summary: {
    total: number;
    active: number;
    completed: number;
    archived: number;
  };
};

export type ProjectIdentityReadModel = {
  project: ProjectRecord;
  goals: ProjectGoalRecord[];
};

export async function getProjectsReadModel(
  actor: AuthenticatedActor,
  repository: ProjectsRepository,
  view: ProjectViewFilter,
): Promise<ApplicationResult<ProjectsReadModel>> {
  const [projectsResult, statusesResult] = await Promise.all([
    repository.listProjects(actor, view),
    repository.listProjectStatuses(actor),
  ]);

  if (!projectsResult.ok || !statusesResult.ok) {
    return applicationFailure("Unable to load projects right now.");
  }

  const projects = projectsResult.value;
  const statuses = statusesResult.value;
  const summary = {
    total: statuses.length,
    active: statuses.filter((status) => status === "active").length,
    completed: statuses.filter((status) => status === "done").length,
    archived: statuses.filter((status) => isProjectArchivedStatus(status)).length,
  };

  if (projects.length === 0) {
    return applicationSuccess({ projects: [], summary });
  }

  const tasksResult = await repository.listTasksForProjects(
    actor,
    projects.map((project) => project.id),
  );

  if (!tasksResult.ok) {
    return applicationFailure("Unable to load project task context right now.");
  }

  const tasksByProject = new Map<string, ProjectTaskContextRecord[]>();
  for (const task of tasksResult.value) {
    const projectTasks = tasksByProject.get(task.projectId) ?? [];
    projectTasks.push(task);
    tasksByProject.set(task.projectId, projectTasks);
  }

  return applicationSuccess({
    projects: projects.map((project) => {
      const projectTasks = tasksByProject.get(project.id) ?? [];
      const statusCountMap = new Map<string, number>();
      for (const task of projectTasks) {
        statusCountMap.set(task.status, (statusCountMap.get(task.status) ?? 0) + 1);
      }
      const completedTaskCount = projectTasks.filter((task) => task.status === "done").length;
      const progressPercent = projectTasks.length
        ? Math.round((completedTaskCount / projectTasks.length) * 100)
        : 0;
      const statusCounts = Array.from(statusCountMap.entries())
        .map(([status, count]) => ({ status, count }))
        .sort((left, right) => right.count - left.count || left.status.localeCompare(right.status))
        .slice(0, 3);

      return {
        ...project,
        taskCount: projectTasks.length,
        completedTaskCount,
        progressPercent,
        statusCounts,
        recentTasks: projectTasks.slice(0, 2),
      };
    }),
    summary,
  });
}

export async function getProjectIdentityReadModel(
  actor: AuthenticatedActor,
  repository: ProjectsRepository,
  slug: string,
): Promise<ApplicationResult<ProjectIdentityReadModel | null>> {
  const projectResult = await repository.getProjectBySlug(actor, slug.trim());
  if (!projectResult.ok) {
    return applicationFailure("Unable to load project right now.");
  }
  if (!projectResult.value) {
    return applicationSuccess(null);
  }

  const goalsResult = await repository.listGoalsForProject(actor, projectResult.value.id);
  if (!goalsResult.ok) {
    return applicationFailure("Unable to load project goals right now.");
  }

  return applicationSuccess({
    project: projectResult.value,
    goals: goalsResult.value,
  });
}
