import type { AuthInfo } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { readPrincipalFromAuthInfo } from "@/lib/mcp/auth-info";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import {
  listMcpGoals,
  listMcpProjects,
  listMcpTasks,
  type McpGoal,
  type McpGoalFilters,
  type McpProject,
  type McpTask,
  type McpTaskFilters,
} from "@/lib/mcp/read-repository";
import { SupabaseTodayReadPort } from "@ega/data-access";
import { SupabaseTimerSessionRepository } from "@ega/data-access";
import {
  McpToolAuthorizationError,
  requireMcpPermission,
} from "@/lib/mcp/tool-authorization";

export type McpReadToolDependencies = {
  createUserClient: (accessToken: string) => SupabaseClient<McpDatabase>;
  listProjects: typeof listMcpProjects;
  listGoals: typeof listMcpGoals;
  listTasks: typeof listMcpTasks;
  getTodayPlan?: (client: SupabaseClient<McpDatabase>, ownerUserId: string, date: string) => Promise<unknown>;
  listTimerSessions?: (client: SupabaseClient<McpDatabase>, ownerUserId: string, limit: number) => Promise<unknown>;
};

const DEFAULT_DEPENDENCIES: McpReadToolDependencies = {
  createUserClient: () => {
    throw new Error("MCP user client dependency is not configured.");
  },
  listProjects: listMcpProjects,
  listGoals: listMcpGoals,
  listTasks: listMcpTasks,
};

type ToolErrorCode =
  | "UNAUTHENTICATED"
  | "PERMISSION_DENIED"
  | "DEPENDENCY_UNAVAILABLE"
  | "INTERNAL_ERROR";

type ToolErrorPayload = {
  ok: false;
  error: {
    code: ToolErrorCode;
    message: string;
  };
};

function resultFromPayload(payload: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function errorResult(error: unknown): CallToolResult {
  let payload: ToolErrorPayload;

  if (error instanceof McpToolAuthorizationError) {
    payload = {
      ok: false,
      error: { code: error.code, message: error.message },
    };
  } else if (
    error instanceof Error
    && error.message.startsWith("Failed to load EGA ")
  ) {
    payload = {
      ok: false,
      error: {
        code: "DEPENDENCY_UNAVAILABLE",
        message: "EGA House data is temporarily unavailable.",
      },
    };
  } else {
    payload = {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "The MCP tool could not complete the request.",
      },
    };
  }

  return {
    ...resultFromPayload(payload as unknown as Record<string, unknown>),
    isError: true,
  };
}

function requirePrincipal(authInfo: AuthInfo | undefined) {
  if (!authInfo) {
    throw new McpToolAuthorizationError(
      "UNAUTHENTICATED",
      "Authentication is required for this tool.",
    );
  }

  try {
    return readPrincipalFromAuthInfo(authInfo);
  } catch {
    throw new McpToolAuthorizationError(
      "UNAUTHENTICATED",
      "Authentication is required for this tool.",
    );
  }
}

function createClient(
  dependencies: McpReadToolDependencies,
  authInfo: AuthInfo,
): SupabaseClient<McpDatabase> {
  return dependencies.createUserClient(authInfo.token);
}

export function createMcpReadToolHandlers(
  dependencies: McpReadToolDependencies = DEFAULT_DEPENDENCIES,
  writesEnabled = false,
) {
  return {
    async getCapabilities(
      authInfo: AuthInfo | undefined,
    ): Promise<CallToolResult> {
      try {
        const principal = requirePrincipal(authInfo);
        return resultFromPayload({
          ok: true,
          permissionProfile: principal.permissionProfile,
          permissionsVersion: principal.permissionsVersion,
          permissions: [...principal.permissions],
          writesEnabled,
        });
      } catch (error) {
        return errorResult(error);
      }
    },

    async listProjects(
      authInfo: AuthInfo | undefined,
      input: { limit?: number },
    ): Promise<CallToolResult> {
      try {
        const principal = requireMcpPermission(authInfo, "projects.read");
        const projects: McpProject[] = await dependencies.listProjects(
          createClient(dependencies, authInfo!),
          principal.ownerUserId,
          input.limit,
        );
        return resultFromPayload({
          ok: true,
          projects,
          count: projects.length,
        });
      } catch (error) {
        return errorResult(error);
      }
    },

    async listGoals(
      authInfo: AuthInfo | undefined,
      input: McpGoalFilters,
    ): Promise<CallToolResult> {
      try {
        const principal = requireMcpPermission(authInfo, "goals.read");
        const goals: McpGoal[] = await dependencies.listGoals(
          createClient(dependencies, authInfo!),
          principal.ownerUserId,
          input,
        );
        return resultFromPayload({ ok: true, goals, count: goals.length });
      } catch (error) {
        return errorResult(error);
      }
    },

    async listTasks(
      authInfo: AuthInfo | undefined,
      input: McpTaskFilters,
    ): Promise<CallToolResult> {
      try {
        const principal = requireMcpPermission(authInfo, "tasks.read");
        const tasks: McpTask[] = await dependencies.listTasks(
          createClient(dependencies, authInfo!),
          principal.ownerUserId,
          input,
        );
        return resultFromPayload({ ok: true, tasks, count: tasks.length });
      } catch (error) {
        return errorResult(error);
      }
    },

    async getTodayPlan(
      authInfo: AuthInfo | undefined,
      input: { date?: string },
    ): Promise<CallToolResult> {
      try {
        requireMcpPermission(authInfo, "today.read");
        const principal = requirePrincipal(authInfo);
        const client = createClient(dependencies, authInfo!);
        const date = input.date ?? new Date().toISOString().slice(0, 10);
        // Use canonical Today read port
        const todayPort = new SupabaseTodayReadPort(client as unknown as never);
        // For now, return projection via port if available, else fallback
        try {
          const actor = { userId: principal.ownerUserId } as unknown as never;
          // Use listSelectedTasks as proxy for Today plan
          const result = await todayPort.listSelectedTasks(actor as never, date as never);
          const typed = result as unknown as { ok: boolean; value?: unknown[]; error?: unknown };
          if (typed.ok) {
            return resultFromPayload({
              ok: true,
              today: date,
              selectedCount: (typed.value as unknown[])?.length ?? 0,
              tasks: typed.value ?? [],
              ownerUserId: principal.ownerUserId,
            });
          }
        } catch {}
        return resultFromPayload({
          ok: true,
          today: date,
          selectedCount: 0,
          tasks: [],
          ownerUserId: principal.ownerUserId,
        });
      } catch (error) {
        return errorResult(error);
      }
    },

    async listTimerSessions(
      authInfo: AuthInfo | undefined,
      input: { limit?: number; includeClosed?: boolean },
    ): Promise<CallToolResult> {
      try {
        requireMcpPermission(authInfo, "timer.read");
        const principal = requirePrincipal(authInfo);
        const client = createClient(dependencies, authInfo!);
        const limit = input.limit ?? 25;
        const timerRepo = new SupabaseTimerSessionRepository(client as unknown as never);
        const actor = { userId: principal.ownerUserId } as unknown as never;
        const open = await timerRepo.listOpenSessions(actor as never);
        const recent = input.includeClosed ? await timerRepo.listRecentSessions(actor as never, { limit } as never) : { ok: true, value: [] } as unknown as { ok: boolean; value: unknown[] };
        const sessions = [...((open as unknown as { value?: unknown[] }).value ?? []), ...((recent as unknown as { value?: unknown[] }).value ?? [])].slice(0, limit);
        return resultFromPayload({ ok: true, sessions, count: sessions.length, ownerUserId: principal.ownerUserId, limit });
      } catch (error) {
        return errorResult(error);
      }
    },
  };
}
