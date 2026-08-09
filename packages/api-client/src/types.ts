/**
 * Wire DTO types for the EGA House HTTP transport (@ega/server, PR5).
 *
 * These mirror the JSON shapes produced by the Hono routes in `apps/server`
 * and the read models/records in `@ega/application`. The client must not
 * import application internals, so the shapes are re-declared here as
 * client-local types. Where @ega/contracts already carries a shared DTO for
 * the same concept it is the preferred source — none exist for projects and
 * goals yet, so these stay local until the contract package grows them.
 */

/** View filters accepted by the server's list endpoints (missing => "active"). */
export type ProjectViewFilter = "active" | "archived" | "all";
export type GoalViewFilter = "active" | "archived" | "all";

/** Status value sets enforced by @ega/domain. */
export type ProjectStatus = "planned" | "active" | "done" | "paused" | "archived";
export type GoalStatus = "draft" | "active" | "done" | "paused";
export type GoalHealth = "on_track" | "at_risk" | "off_track";

/** POST /api/projects response body: `{ ok: true, values }`. */
export type ProjectFormValues = {
  name: string;
  slug: string;
  description: string;
};

/** POST /api/goals response body: `{ ok: true, values }`. */
export type GoalFormValues = {
  title: string;
  projectId: string;
  description: string;
  nextStep: string;
  health: string;
  status: string;
  slug: string;
};

/** `projects` table row as serialized by the transport. */
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

/** GET /api/projects item: ProjectRecord enriched with task context. */
export type ProjectCardReadModel = ProjectRecord & {
  taskCount: number;
  completedTaskCount: number;
  progressPercent: number;
  statusCounts: Array<{ status: string; count: number }>;
  recentTasks: ProjectTaskContextRecord[];
};

/** GET /api/projects response body. */
export type ProjectsReadModel = {
  projects: ProjectCardReadModel[];
  summary: {
    total: number;
    active: number;
    completed: number;
    archived: number;
  };
};

/** GET /api/projects/:slug response body (404 `NOT_FOUND` when missing). */
export type ProjectIdentityReadModel = {
  project: ProjectRecord;
  goals: ProjectGoalRecord[];
};

/** `goals` table row as serialized by the transport. */
export type GoalTaskContextRecord = {
  id: string;
  title: string;
  status: string;
  goalId: string;
};

/** GET /api/goals item. */
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

/** GET /api/goals response body. */
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

/** POST /api/projects request body. */
export type CreateProjectInput = {
  name: string;
  slug: string;
  description: string | null;
};

/** POST /api/goals request body. */
export type CreateGoalInput = {
  title: string;
  projectId: string;
  description: string | null;
  nextStep: string | null;
  health: GoalHealth | null;
  status: GoalStatus;
  slug: string | null;
};

/** GET /health response body. */
export type HealthResponse = { status: "ok" };
