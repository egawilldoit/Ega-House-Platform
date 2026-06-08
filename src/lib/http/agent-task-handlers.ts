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
} from "@/lib/services/agent-task-service";
import {
  forbidden,
  notFound,
  invalidRequest,
  rateLimited,
} from "@/lib/http/agent-errors";
import { INTERNAL_ERROR_RESPONSE } from "@/lib/contracts/agent";
import type {
  AgentProjectListResponse,
  AgentGoalListResponse,
  AgentTaskListResponse,
  AgentTokenScopes,
} from "@/lib/contracts/agent";

export type TelemetryFn = (tokenId: string) => Promise<void>;

// ---- Scope helpers ----

function checkScope(
  scopes: AgentTokenScopes,
  resource: "projects" | "goals" | "tasks",
  operation: "read",
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
