import type { AuthInfo, CallToolResult } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  clearCompletedToday,
  createAuthenticatedActorFromIdentity,
  getTodayPlan,
  planTaskForToday,
  removeTaskFromToday,
  updateTodayTaskStatus,
  type TaskRecord,
  type TodayPlan,
  type TodayReadPort,
  type TodayTaskRepository,
} from "@ega/application";
import { SupabaseTasksRepository, SupabaseTodayReadPort } from "@ega/data-access";

import { readPrincipalFromAuthInfo } from "@/lib/mcp/auth-info";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { McpToolAuthorizationError, requireMcpPermission } from "@/lib/mcp/tool-authorization";

export type ClearCompletedMrtr = {
  firstRound(
    input: { date: string; operationId: string },
    principal: McpPrincipal,
  ): Promise<CallToolResult | unknown>;
  verifySecondRound(
    ctx: unknown,
    input: { date: string; operationId: string },
    principal: McpPrincipal,
  ): Promise<void>;
};

export type McpWriteModuleDeps = {
  createUserClient: (accessToken: string) => SupabaseClient<McpDatabase>;
  clearCompletedMrtr: ClearCompletedMrtr;
  readVerifiedClearCompletedState: (ctx: unknown) => unknown | undefined;
};

type ToolPayload = Record<string, unknown>;

type ToolErrorPayload = {
  ok: false;
  error: { code: string; message: string };
};

function resultFromPayload(payload: ToolPayload): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function errorResult(error: unknown): CallToolResult {
  let payload: ToolErrorPayload;
  if (error instanceof McpToolAuthorizationError) {
    payload = { ok: false, error: { code: error.code, message: error.message } };
  } else {
    payload = {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "The MCP tool could not complete the request.",
      },
    };
  }
  return { ...resultFromPayload(payload as unknown as ToolPayload), isError: true };
}

function applicationErrorResult(errorMessage: string): CallToolResult {
  const payload: ToolErrorPayload = {
    ok: false,
    error: { code: "APPLICATION_ERROR", message: errorMessage },
  };
  return { ...resultFromPayload(payload as unknown as ToolPayload), isError: true };
}

function asToolResult(value: unknown): CallToolResult {
  if (
    value
    && typeof value === "object"
    && (
      Array.isArray((value as { content?: unknown }).content)
      || (value as { resultType?: unknown }).resultType === "input_required"
    )
  ) {
    return value as CallToolResult;
  }
  return resultFromPayload({ ok: true, pendingConfirmation: value });
}

function requirePrincipal(authInfo: AuthInfo | undefined): McpPrincipal {
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

function actorFor(principal: McpPrincipal) {
  return createAuthenticatedActorFromIdentity({ id: principal.ownerUserId });
}

function toPlanPayload(plan: TodayPlan): ToolPayload {
  return {
    ok: true,
    today: plan.date,
    sections: plan.sections,
    suggestions: plan.suggestions,
    summary: plan.summary,
    activeTimer: plan.activeTimer,
  };
}

function toTaskPayload(task: TaskRecord): ToolPayload {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    projectId: task.projectId,
    goalId: task.goalId,
    plannedForDate: task.plannedForDate,
    dueDate: task.dueDate,
    blockedReason: task.blockedReason,
    updatedAt: task.updatedAt,
  };
}

function readPortFor(deps: McpWriteModuleDeps, authInfo: AuthInfo): TodayReadPort {
  return new SupabaseTodayReadPort(deps.createUserClient(authInfo.token));
}

function todayRepositoryFor(deps: McpWriteModuleDeps, authInfo: AuthInfo): TodayTaskRepository {
  return new SupabaseTasksRepository(deps.createUserClient(authInfo.token));
}

export function createMcpTodayWriteHandlers(deps: McpWriteModuleDeps) {
  return {
    async getTodayPlan(
      authInfo: AuthInfo | undefined,
      input: { date?: string },
    ): Promise<CallToolResult> {
      try {
        const principal = requireMcpPermission(authInfo, "today.read");
        requirePrincipal(authInfo);
        const port = readPortFor(deps, authInfo!);
        const result = await getTodayPlan(actorFor(principal), port, { date: input.date });
        if (!result.ok) return applicationErrorResult(result.errorMessage);
        return resultFromPayload(toPlanPayload(result.data));
      } catch (error) {
        return errorResult(error);
      }
    },

    async planTaskForToday(
      authInfo: AuthInfo | undefined,
      input: { taskId: string; date: string },
    ): Promise<CallToolResult> {
      try {
        const principal = requireMcpPermission(authInfo, "today.update");
        requirePrincipal(authInfo);
        const repository = todayRepositoryFor(deps, authInfo!);
        const result = await planTaskForToday(actorFor(principal), repository, {
          taskId: input.taskId,
          date: input.date,
        });
        if (!result.ok) return applicationErrorResult(result.errorMessage);
        return resultFromPayload({ ok: true, task: toTaskPayload(result.data) });
      } catch (error) {
        return errorResult(error);
      }
    },

    async removeTaskFromToday(
      authInfo: AuthInfo | undefined,
      input: { taskId: string },
    ): Promise<CallToolResult> {
      try {
        const principal = requireMcpPermission(authInfo, "today.update");
        requirePrincipal(authInfo);
        const repository = todayRepositoryFor(deps, authInfo!);
        const result = await removeTaskFromToday(actorFor(principal), repository, {
          taskId: input.taskId,
        });
        if (!result.ok) return applicationErrorResult(result.errorMessage);
        return resultFromPayload({ ok: true, task: toTaskPayload(result.data) });
      } catch (error) {
        return errorResult(error);
      }
    },

    async updateTodayTaskStatus(
      authInfo: AuthInfo | undefined,
      input: { taskId: string; status: string; blockedReason?: string | null },
    ): Promise<CallToolResult> {
      try {
        const principal = requireMcpPermission(authInfo, "today.update");
        requirePrincipal(authInfo);
        const repository = todayRepositoryFor(deps, authInfo!);
        const result = await updateTodayTaskStatus(actorFor(principal), repository, {
          taskId: input.taskId,
          status: input.status,
          blockedReason: input.blockedReason,
        });
        if (!result.ok) return applicationErrorResult(result.errorMessage);
        return resultFromPayload({ ok: true, task: toTaskPayload(result.data) });
      } catch (error) {
        return errorResult(error);
      }
    },

    async clearCompletedToday(
      authInfo: AuthInfo | undefined,
      input: { date: string; operationId: string },
      ctx?: unknown,
    ): Promise<CallToolResult> {
      try {
        const principal = requireMcpPermission(authInfo, "today.update");
        requirePrincipal(authInfo);
        const verifiedState = deps.readVerifiedClearCompletedState(ctx);
        if (!verifiedState) {
          const pending = await deps.clearCompletedMrtr.firstRound(
            { date: input.date, operationId: input.operationId },
            principal,
          );
          return asToolResult(pending);
        }
        await deps.clearCompletedMrtr.verifySecondRound(
          ctx,
          { date: input.date, operationId: input.operationId },
          principal,
        );
        requireMcpPermission(authInfo, "today.update");
        const repository = todayRepositoryFor(deps, authInfo!);
        const result = await clearCompletedToday(actorFor(principal), repository, {
          date: input.date,
        });
        if (!result.ok) return applicationErrorResult(result.errorMessage);
        return resultFromPayload({ ok: true, clearedCount: result.data.clearedCount });
      } catch (error) {
        return errorResult(error);
      }
    },
  };
}
