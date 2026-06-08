// Types only — no runtime exports. Zero dependencies.
// This module can be imported anywhere without side effects.

export type AgentTokenScopes = {
  tasks?: {
    read?: boolean;
    create?: boolean;
    updateAny?: boolean;
    archive?: boolean;
    bulk?: boolean;
    bulkLimit?: number;
    idempotency?: string;
  };
  projects?: {
    read?: boolean;
  };
  goals?: {
    read?: boolean;
  };
};

export type AgentAuthContext = {
  tokenId: string;
  ownerUserId: string;
  scopes: AgentTokenScopes;
};

export type AgentCapabilities = {
  tasks: {
    read: boolean;
    create: boolean;
    updateAny: boolean;
    archive: boolean;
    bulk: boolean;
    bulkLimit?: number;
    idempotency?: string;
  };
  projects: { read: boolean };
  goals: { read: boolean };
};

export type AgentCapabilitiesResponse = {
  ok: true;
  agent: string;
  capabilities: AgentCapabilities;
};

export type AgentErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID_REQUEST" | "VALIDATION_ERROR" | "CONFLICT" | "UNPROCESSABLE" | "RATE_LIMITED" | "INTERNAL_ERROR";

export type AgentErrorResponse = {
  ok: false;
  error: {
    code: AgentErrorCode;
    message: string;
  };
};

export type AgentAuthSuccess = {
  ok: true;
  context: AgentAuthContext;
};

export type AgentAuthFailure = {
  ok: false;
  response: AgentErrorResponse;
  status: 401 | 500;
};

export type AgentAuthResult = AgentAuthSuccess | AgentAuthFailure;

export const INTERNAL_ERROR_RESPONSE: AgentErrorResponse = {
  ok: false,
  error: {
    code: "INTERNAL_ERROR",
    message: "The request could not be completed.",
  },
};

export type TokenRecord = {
  id: string;
  ownerUserId: string;
  name: string;
  tokenPrefix: string;
  tokenHash: string;
  scopes: AgentTokenScopes;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NewTokenRecord = {
  ownerUserId: string;
  name: string;
  tokenPrefix: string;
  tokenHash: string;
  scopes: AgentTokenScopes;
};

// ---- Agent read response types ----

export type AgentProjectResponse = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentGoalResponse = {
  id: string;
  projectId: string;
  title: string;
  slug: string | null;
  description: string | null;
  nextStep: string | null;
  health: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentTaskResponse = {
  id: string;
  projectId: string;
  goalId: string | null;
  title: string;
  description: string | null;
  blockedReason: string | null;
  status: string;
  priority: string;
  estimateMinutes: number | null;
  focusRank: number | null;
  dueDate: string | null;
  plannedForDate: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  projectName: string | null;
  goalTitle: string | null;
};

export type AgentProjectListResponse = {
  ok: true;
  projects: AgentProjectResponse[];
};

export type AgentGoalListResponse = {
  ok: true;
  goals: AgentGoalResponse[];
};

export type AgentTaskListResponse = {
  ok: true;
  tasks: AgentTaskResponse[];
};

// ---- Agent task create types ----

export type AgentCreateTaskPayload = {
  title: string;
  projectId: string;
  goalId?: string | null;
  description?: string | null;
  status?: string;
  priority?: string;
  estimateMinutes?: number | null;
  focusRank?: number | null;
  dueDate?: string | null;
  plannedForDate?: string | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  blockedReason?: string | null;
  source?: string;
  sourceId?: string;
};

export type AgentTaskCreateBulkResponse = {
  ok: true;
  created: AgentTaskResponse[];
  existing: AgentTaskResponse[];
  errors: { index: number; error: string }[];
};

export type AgentTaskUpdatePayload = {
  taskId?: string;
  source?: string;
  sourceId?: string;
  title?: string;
  description?: string | null;
  goalId?: string | null;
  status?: string;
  priority?: string;
  dueDate?: string | null;
  estimateMinutes?: number | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  blockedReason?: string | null;
};

export type AgentTaskUpdateBulkResponse = {
  ok: true;
  updated: AgentTaskResponse[];
  errors: { index: number; error: string }[];
};

export type AgentTaskArchivePayload = {
  taskId?: string;
  source?: string;
  sourceId?: string;
  archived: boolean;
};

export type AgentTaskArchiveBulkResponse = {
  ok: true;
  archived: AgentTaskResponse[];
  unarchived: AgentTaskResponse[];
  errors: { index: number; error: string }[];
};
