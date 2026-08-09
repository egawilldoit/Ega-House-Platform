// Testable HTTP handlers for agent read endpoints.
// Does NOT import @/db/client — accepts TokenRepository via DI.
// Tests import this module directly with mock repositories.

import { NextResponse } from "next/server";

import type { TokenRepository } from "@/lib/services/agent-token-repository";
import { resolveAgentAuth } from "@/lib/services/agent-token-service";
import { AgentRateLimitService } from "@/lib/services/agent-rate-limit-service";
import {
  getProjects,
  getGoals,
  getTasks,
  createTasks,
  updateTasks,
  archiveTasks,
} from "@/lib/services/agent-task-service";
import {
  forbidden,
  notFound,
  invalidRequest,
  rateLimited,
  validationError,
} from "@/lib/http/agent-errors";
import { INTERNAL_ERROR_RESPONSE } from "@/lib/contracts/agent";
import type {
  AgentProjectListResponse,
  AgentGoalListResponse,
  AgentTaskListResponse,
  AgentTaskCreateBulkResponse,
  AgentTokenScopes,
  AgentCreateTaskPayload,
} from "@/lib/contracts/agent";

export type TelemetryFn = (tokenId: string) => Promise<void>;

// ---- Scope helpers ----

function checkScope(
  scopes: AgentTokenScopes,
  resource: "projects" | "goals" | "tasks",
  operation: "read" | "create",
): boolean {
  const section = scopes[resource];
  if (!section) return false;
  return (section as Record<string, boolean | undefined>)[operation] === true;
}

function denyForbidden(resource: string): ReturnType<typeof NextResponse.json> {
  const err = forbidden(`Agent token lacks "${resource}:read" scope.`);
  return NextResponse.json(err.body, { status: err.status });
}

// ---- Handler factory ----

export function createReadHandlers(
  repo: TokenRepository,
  rateLimiter?: AgentRateLimitService,
  telemetry?: TelemetryFn,
) {
  async function authenticate(request: Request) {
    const auth = await resolveAgentAuth(request, repo);
    if (!auth.ok) {
      return { response: NextResponse.json(auth.response, { status: auth.status }), auth: null };
    }
    return { response: null, auth: auth.context };
  }

  function checkRateLimit(tokenId: string): ReturnType<typeof NextResponse.json> | null {
    if (!rateLimiter) return null;
    const result = rateLimiter.check(tokenId);
    if (!result.ok) {
      const err = rateLimited(result.retryAfter);
      return NextResponse.json(err.body, {
        status: err.status,
        headers: { "Retry-After": String(result.retryAfter) },
      });
    }
    return null;
  }

  function runTelemetry(tokenId: string): void {
    if (telemetry) {
      telemetry(tokenId).catch((err: unknown) => {
        console.warn(
          "[agent-task-handlers] telemetry failed:",
          (err as Error)?.message ?? err,
        );
      });
    }
  }

  // ---- GET /api/agent/projects ----

  const GET_PROJECTS = async (request: Request) => {
    try {
      const { response: authResponse, auth } = await authenticate(request);
      if (authResponse) return authResponse;

      // Scope check
      if (!checkScope(auth!.scopes, "projects", "read")) {
        return denyForbidden("projects");
      }

      // Rate limit
      const rateLimitResponse = checkRateLimit(auth!.tokenId);
      if (rateLimitResponse) return rateLimitResponse;

      // Telemetry
      runTelemetry(auth!.tokenId);

      const result = await getProjects(auth!.ownerUserId);

      if (!result.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: { code: "INTERNAL_ERROR", message: result.errorMessage },
          },
          { status: 500 },
        );
      }

      const response: AgentProjectListResponse = {
        ok: true,
        projects: result.data,
      };

      return NextResponse.json(response, { status: 200 });
    } catch (err) {
      console.error("[agent-projects] internal error:", (err as Error)?.message ?? err);
      return NextResponse.json(INTERNAL_ERROR_RESPONSE, { status: 500 });
    }
  };

  // ---- GET /api/agent/goals ----

  const GET_GOALS = async (request: Request) => {
    try {
      const { response: authResponse, auth } = await authenticate(request);
      if (authResponse) return authResponse;

      // Scope check
      if (!checkScope(auth!.scopes, "goals", "read")) {
        return denyForbidden("goals");
      }

      // Rate limit
      const rateLimitResponse = checkRateLimit(auth!.tokenId);
      if (rateLimitResponse) return rateLimitResponse;

      // Telemetry
      runTelemetry(auth!.tokenId);

      // Parse optional projectId filter from query params
      const url = new URL(request.url);
      const projectId = url.searchParams.get("projectId") || undefined;

      const result = await getGoals(auth!.ownerUserId, projectId);

      if (!result.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: { code: "INTERNAL_ERROR", message: result.errorMessage },
          },
          { status: 500 },
        );
      }

      const response: AgentGoalListResponse = {
        ok: true,
        goals: result.data,
      };

      return NextResponse.json(response, { status: 200 });
    } catch (err) {
      console.error("[agent-goals] internal error:", (err as Error)?.message ?? err);
      return NextResponse.json(INTERNAL_ERROR_RESPONSE, { status: 500 });
    }
  };

  // ---- GET /api/agent/tasks ----

  const GET_TASKS = async (request: Request) => {
    try {
      const { response: authResponse, auth } = await authenticate(request);
      if (authResponse) return authResponse;

      // Scope check
      if (!checkScope(auth!.scopes, "tasks", "read")) {
        return denyForbidden("tasks");
      }

      // Rate limit
      const rateLimitResponse = checkRateLimit(auth!.tokenId);
      if (rateLimitResponse) return rateLimitResponse;

      // Telemetry
      runTelemetry(auth!.tokenId);

      // Parse filters from query params
      const url = new URL(request.url);
      const projectId = url.searchParams.get("projectId") || undefined;
      const goalId = url.searchParams.get("goalId") || undefined;
      const status = url.searchParams.get("status") || undefined;
      const priority = url.searchParams.get("priority") || undefined;
      const limitStr = url.searchParams.get("limit");
      const limit = limitStr ? parseInt(limitStr, 10) : undefined;
      const includeArchived = url.searchParams.get("includeArchived") === "true";

      // Validate limit
      if (limit !== undefined && (isNaN(limit) || limit < 1 || limit > 200)) {
        const err = invalidRequest("limit must be between 1 and 200");
        return NextResponse.json(err.body, { status: err.status });
      }

      const result = await getTasks(auth!.ownerUserId, {
        projectId,
        goalId,
        status,
        priority,
        limit,
        includeArchived,
      });

      if (!result.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: { code: "INTERNAL_ERROR", message: result.errorMessage },
          },
          { status: 500 },
        );
      }

      const response: AgentTaskListResponse = {
        ok: true,
        tasks: result.data,
      };

      return NextResponse.json(response, { status: 200 });
    } catch (err) {
      console.error("[agent-tasks] internal error:", (err as Error)?.message ?? err);
      return NextResponse.json(INTERNAL_ERROR_RESPONSE, { status: 500 });
    }
  };

  return { GET_PROJECTS, GET_GOALS, GET_TASKS };
}

// ---- Create handler factory ----

export function createCreateHandlers(
  repo: TokenRepository,
  rateLimiter?: AgentRateLimitService,
  telemetry?: TelemetryFn,
) {
  async function authenticate(request: Request) {
    const auth = await resolveAgentAuth(request, repo);
    if (!auth.ok) {
      return { response: NextResponse.json(auth.response, { status: auth.status }), auth: null };
    }
    return { response: null, auth: auth.context };
  }

  function checkRateLimit(tokenId: string): ReturnType<typeof NextResponse.json> | null {
    if (!rateLimiter) return null;
    const result = rateLimiter.check(tokenId);
    if (!result.ok) {
      const err = rateLimited(result.retryAfter);
      return NextResponse.json(err.body, {
        status: err.status,
        headers: { "Retry-After": String(result.retryAfter) },
      });
    }
    return null;
  }

  function runTelemetry(tokenId: string): void {
    if (telemetry) {
      telemetry(tokenId).catch((err: unknown) => {
        console.warn(
          "[agent-task-handlers] telemetry failed:",
          (err as Error)?.message ?? err,
        );
      });
    }
  }

  // ---- POST /api/agent/tasks ----

  const POST_TASKS = async (request: Request) => {
    try {
      const { response: authResponse, auth } = await authenticate(request);
      if (authResponse) return authResponse;

      // Scope check
      if (!checkScope(auth!.scopes, "tasks", "create")) {
        const err = forbidden(`Agent token lacks "tasks:create" scope.`);
        return NextResponse.json(err.body, { status: err.status });
      }

      // Rate limit
      const rateLimitResponse = checkRateLimit(auth!.tokenId);
      if (rateLimitResponse) return rateLimitResponse;

      // Telemetry
      runTelemetry(auth!.tokenId);

      // Parse request body
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        const err = invalidRequest("Request body must be valid JSON.");
        return NextResponse.json(err.body, { status: err.status });
      }

      const envelope = body as Record<string, unknown> | null;

      if (!envelope || !Array.isArray(envelope.tasks)) {
        const err = invalidRequest('Request must include a "tasks" array.');
        return NextResponse.json(err.body, { status: err.status });
      }

      const tasks = envelope.tasks as unknown[];

      // Determine max tasks from scopes — bulkLimit or 50, whichever is lower
      const scopeBulkLimit = auth!.scopes.tasks?.bulkLimit;
      const maxTasks = scopeBulkLimit !== undefined ? Math.min(scopeBulkLimit, 50) : 50;

      if (tasks.length > maxTasks) {
        const err = invalidRequest(
          `Maximum of ${maxTasks} tasks allowed per request.`,
        );
        return NextResponse.json(err.body, { status: err.status });
      }

      // Validate each task payload shape minimally (service validates deeper)
      const taskPayloads: AgentCreateTaskPayload[] = [];
      for (let i = 0; i < tasks.length; i++) {
        const item = tasks[i] as Record<string, unknown> | null;
        if (!item || typeof item !== "object") {
          const err = invalidRequest(`Task at index ${i} is invalid.`);
          return NextResponse.json(err.body, { status: err.status });
        }
        taskPayloads.push({
          title: String(item.title ?? ""),
          projectId: String(item.projectId ?? item.project_id ?? ""),
          goalId: item.goalId != null ? String(item.goalId) : item.goal_id != null ? String(item.goal_id) : null,
          description: item.description != null ? String(item.description) : null,
          status: item.status != null ? String(item.status) : undefined,
          priority: item.priority != null ? String(item.priority) : undefined,
          estimateMinutes:
            item.estimateMinutes != null
              ? Number(item.estimateMinutes)
              : item.estimate_minutes != null
                ? Number(item.estimate_minutes)
                : undefined,
          focusRank:
            item.focusRank != null
              ? Number(item.focusRank)
              : item.focus_rank != null
                ? Number(item.focus_rank)
                : undefined,
          dueDate: item.dueDate != null ? String(item.dueDate) : item.due_date != null ? String(item.due_date) : null,
          plannedForDate: item.plannedForDate != null ? String(item.plannedForDate) : item.planned_for_date != null ? String(item.planned_for_date) : null,
          scheduledStartAt: item.scheduledStartAt != null ? String(item.scheduledStartAt) : item.scheduled_start_at != null ? String(item.scheduled_start_at) : null,
          scheduledEndAt: item.scheduledEndAt != null ? String(item.scheduledEndAt) : item.scheduled_end_at != null ? String(item.scheduled_end_at) : null,
          blockedReason: item.blockedReason != null ? String(item.blockedReason) : item.blocked_reason != null ? String(item.blocked_reason) : null,
          source: item.source != null ? String(item.source) : undefined,
          sourceId: item.sourceId != null ? String(item.sourceId) : undefined,
        });
      }

      const result = await createTasks(
        auth!.ownerUserId,
        auth!.tokenId,
        taskPayloads,
      );

      const response: AgentTaskCreateBulkResponse = {
        ok: true,
        created: result.created,
        existing: result.existing,
        errors: result.errors,
      };

      return NextResponse.json(response, { status: 200 });
    } catch (err) {
      console.error("[agent-tasks-create] internal error:", (err as Error)?.message ?? err);
      return NextResponse.json(INTERNAL_ERROR_RESPONSE, { status: 500 });
    }
  };

  return { POST_TASKS };
}

// ---- Update handler factory ----

import type { AgentTaskUpdateBulkResponse } from "@/lib/contracts/agent";

export function createUpdateHandlers(
  repo: TokenRepository,
  rateLimiter?: AgentRateLimitService,
  telemetry?: TelemetryFn,
) {
  async function authenticate(request: Request) {
    const auth = await resolveAgentAuth(request, repo);
    if (!auth.ok) {
      return { response: NextResponse.json(auth.response, { status: auth.status }), auth: null };
    }
    return { response: null, auth: auth.context };
  }

  async function PATCH_TASKS(request: Request) {
    try {
      const { response: authResponse, auth } = await authenticate(request);
      if (authResponse) return authResponse;

      if (!auth!.scopes.tasks?.updateAny) {
        const err = forbidden("Missing tasks:updateAny scope.");
        return NextResponse.json(err.body, { status: err.status });
      }

      if (rateLimiter) {
        const result = rateLimiter.check(auth!.tokenId);
        if (!result.ok) {
          const err = rateLimited(result.retryAfter);
          return NextResponse.json(err.body, { status: err.status });
        }
      }

      if (telemetry) {
        telemetry(auth!.tokenId).catch(() => {});
      }

      let body: unknown;
      try { body = await request.json(); } catch {
        const err = invalidRequest("Request body must be valid JSON.");
        return NextResponse.json(err.body, { status: err.status });
      }

      if (!body || typeof body !== "object" || !Array.isArray((body as Record<string, unknown>).tasks)) {
        const err = invalidRequest('Request body must include a "tasks" array.');
        return NextResponse.json(err.body, { status: err.status });
      }

      const tasks = (body as Record<string, unknown[]>).tasks!;
      const maxTasks = auth!.scopes.tasks?.bulkLimit ?? 50;
      if (tasks.length > maxTasks) {
        const err = invalidRequest(`Maximum of ${maxTasks} tasks allowed per request.`);
        return NextResponse.json(err.body, { status: err.status });
      }

      const updates: Array<Record<string, unknown>> = [];
      for (let i = 0; i < tasks.length; i++) {
        const item = tasks[i] as Record<string, unknown> | null;
        if (!item || typeof item !== "object") {
          const err = invalidRequest(`Task at index ${i} is invalid.`);
          return NextResponse.json(err.body, { status: err.status });
        }
        const update: Record<string, unknown> = {
          taskId: item.taskId != null ? String(item.taskId) : item.task_id != null ? String(item.task_id) : undefined,
          source: item.source != null ? String(item.source) : undefined,
          sourceId: item.sourceId != null ? String(item.sourceId) : undefined,
          title: item.title != null ? String(item.title) : undefined,
          description: item.description != null ? String(item.description) : undefined,
          goalId: item.goalId != null ? String(item.goalId) : item.goal_id != null ? String(item.goal_id) : undefined,
          status: item.status != null ? String(item.status) : undefined,
          priority: item.priority != null ? String(item.priority) : undefined,
          dueDate: item.dueDate != null ? String(item.dueDate) : item.due_date != null ? String(item.due_date) : undefined,
          estimateMinutes: item.estimateMinutes != null ? Number(item.estimateMinutes) : item.estimate_minutes != null ? Number(item.estimate_minutes) : undefined,
          scheduledStartAt: item.scheduledStartAt != null ? String(item.scheduledStartAt) : item.scheduled_start_at != null ? String(item.scheduled_start_at) : undefined,
          scheduledEndAt: item.scheduledEndAt != null ? String(item.scheduledEndAt) : item.scheduled_end_at != null ? String(item.scheduled_end_at) : undefined,
          blockedReason: item.blockedReason != null ? String(item.blockedReason) : item.blocked_reason != null ? String(item.blocked_reason) : undefined,
        };
        // Remove undefined keys
        Object.keys(update).forEach(k => update[k] === undefined && delete update[k]);
        updates.push(update);
      }

      const result = await updateTasks(auth!.ownerUserId, auth!.tokenId, updates as never);

      const response: AgentTaskUpdateBulkResponse = {
        ok: true,
        updated: result.updated,
        errors: result.errors,
      };

      return NextResponse.json(response, { status: 200 });
    } catch (err) {
      console.error("[agent-tasks-update] internal error:", (err as Error)?.message ?? err);
      return NextResponse.json(INTERNAL_ERROR_RESPONSE, { status: 500 });
    }
  }

  return { PATCH_TASKS };
}

// ---- Archive handler factory ----

import type { AgentTaskArchiveBulkResponse } from "@/lib/contracts/agent";

export function createArchiveHandlers(
  repo: TokenRepository,
  rateLimiter?: AgentRateLimitService,
  telemetry?: TelemetryFn,
) {
  async function authenticate(request: Request) {
    const auth = await resolveAgentAuth(request, repo);
    if (!auth.ok) {
      return { response: NextResponse.json(auth.response, { status: auth.status }), auth: null };
    }
    return { response: null, auth: auth.context };
  }

  async function POST_ARCHIVE(request: Request) {
    try {
      const { response: authResponse, auth } = await authenticate(request);
      if (authResponse) return authResponse;

      if (!auth!.scopes.tasks?.archive) {
        const err = forbidden("Missing tasks:archive scope.");
        return NextResponse.json(err.body, { status: err.status });
      }

      if (rateLimiter) {
        const result = rateLimiter.check(auth!.tokenId);
        if (!result.ok) {
          const err = rateLimited(result.retryAfter);
          return NextResponse.json(err.body, { status: err.status });
        }
      }

      if (telemetry) {
        telemetry(auth!.tokenId).catch(() => {});
      }

      let body: unknown;
      try { body = await request.json(); } catch {
        const err = invalidRequest("Request body must be valid JSON.");
        return NextResponse.json(err.body, { status: err.status });
      }

      if (!body || typeof body !== "object" || !Array.isArray((body as Record<string, unknown>).tasks)) {
        const err = invalidRequest('Request body must include a "tasks" array.');
        return NextResponse.json(err.body, { status: err.status });
      }

      const tasks = (body as Record<string, unknown[]>).tasks!;
      const maxTasks = auth!.scopes.tasks?.bulkLimit ?? 50;
      if (tasks.length > maxTasks) {
        const err = invalidRequest(`Maximum of ${maxTasks} tasks allowed per request.`);
        return NextResponse.json(err.body, { status: err.status });
      }

      const archivePayloads: Array<{ taskId?: string; source?: string; sourceId?: string; archived: boolean }> = [];
      for (let i = 0; i < tasks.length; i++) {
        const item = tasks[i] as Record<string, unknown> | null;
        if (!item || typeof item !== "object") {
          const err = invalidRequest(`Task at index ${i} is invalid.`);
          return NextResponse.json(err.body, { status: err.status });
        }
        const archived = item.archived;
        if (typeof archived !== "boolean") {
          const err = invalidRequest(`Task at index ${i} must have a boolean "archived" field.`);
          return NextResponse.json(err.body, { status: err.status });
        }
        archivePayloads.push({
          taskId: item.taskId != null ? String(item.taskId) : item.task_id != null ? String(item.task_id) : undefined,
          source: item.source != null ? String(item.source) : undefined,
          sourceId: item.sourceId != null ? String(item.sourceId) : undefined,
          archived,
        });
      }

      const result = await archiveTasks(auth!.ownerUserId, auth!.tokenId, archivePayloads);

      const response: AgentTaskArchiveBulkResponse = {
        ok: true,
        archived: result.archived,
        unarchived: result.unarchived,
        errors: result.errors,
      };

      return NextResponse.json(response, { status: 200 });
    } catch (err) {
      console.error("[agent-tasks-archive] internal error:", (err as Error)?.message ?? err);
      return NextResponse.json(INTERNAL_ERROR_RESPONSE, { status: 500 });
    }
  }

  return { POST_ARCHIVE };
}
