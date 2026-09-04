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

/** Exact deletion impact returned by GET /api/projects/:id/purge-preview. */
export type ProjectPurgeImpact = {
  taskCount: number;
  goalCount: number;
  sessionCount: number;
  activeSessionCount: number;
  reminderCount: number;
  recurrenceCount: number;
  externalRefCount: number;
  taskNotificationCount: number;
  calendarEventCount: number;
};

/** GET /api/projects/:id/purge-preview response body. */
export type ProjectPurgePreviewResponse = {
  projectId: string;
  projectName: string;
  impact: ProjectPurgeImpact;
};

/** Summary returned after POST /api/projects/:id/purge. */
export type ProjectPurgeSummary = {
  tasksDeleted: number;
  goalsDeleted: number;
  sessionsDeleted: number;
  externalRefsDeleted: number;
  notificationsDeleted: number;
  calendarDeleteJobsEnqueued: number;
};

/** POST /api/projects/:id/purge request body. */
export type PurgeProjectInput = {
  confirmationName: string;
  expectedTaskCount: number;
  expectedGoalCount: number;
};

/** POST /api/projects/:id/purge response body. */
export type ProjectPurgeResponse = {
  ok: true;
  deleted: ProjectPurgeSummary;
};
