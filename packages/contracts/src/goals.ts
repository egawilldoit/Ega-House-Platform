import type { GoalHealth, GoalStatus, GoalViewFilter } from "@ega/domain";

export type { GoalHealth, GoalStatus, GoalViewFilter } from "@ega/domain";

/** Normalized values echoed by POST /api/goals. */
export type GoalFormValues = {
  title: string;
  projectId: string;
  description: string;
  nextStep: string;
  health: string;
  status: string;
  slug: string;
};

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

export type CreateGoalResponse = {
  ok: true;
  values: GoalFormValues;
};

export type GoalMutationResponse = { ok: true };
