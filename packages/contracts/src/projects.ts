export type { ProjectStatus, ProjectViewFilter } from "@ega/domain";

/** Normalized values echoed by POST /api/projects. */
export type ProjectFormValues = {
  name: string;
  slug: string;
  description: string;
};

/** Serialized project row used by project list and identity responses. */
export type ProjectRecord = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectTaskContextRecord = {
  id: string;
  projectId: string;
  title: string;
  status: string;
  priority: string;
  updatedAt: string;
};

export type ProjectGoalRecord = {
  id: string;
  title: string;
  projectId: string;
};

/** GET /api/projects response body. */
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

/** GET /api/projects/:slug response body. */
export type ProjectIdentityReadModel = {
  project: ProjectRecord;
  goals: ProjectGoalRecord[];
};

/** POST /api/projects request body. */
export type CreateProjectInput = {
  name: string;
  slug: string;
  description: string | null;
};

export type CreateProjectResponse = {
  ok: true;
  values: ProjectFormValues;
};

export type ProjectMutationResponse = { ok: true };
