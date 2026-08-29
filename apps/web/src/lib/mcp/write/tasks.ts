import type { AuthInfo, CallToolResult } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  archiveTask as archiveTaskService,
  cancelTaskReminder as cancelTaskReminderService,
  createTask as createTaskService,
  createTaskReminder as createTaskReminderService,
  getTaskReadModel,
  pinTask,
  unarchiveTask as unarchiveTaskService,
  unpinTask,
  updateTask as updateTaskService,
} from "@ega/application";
import { SupabaseTasksRepository } from "@ega/data-access";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import {
  McpToolAuthorizationError,
  requireMcpPermission,
} from "@/lib/mcp/tool-authorization";

export type McpWriteModuleDeps = {
  createUserClient: (accessToken: string) => SupabaseClient<McpDatabase>;
};

type McpToolErrorPayload = {
  ok: false;
  error: { code: string; message: string };
};

type McpTaskOkPayload = {
  ok: true;
  task: unknown;
};

function resultFromPayload(payload: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function okPayload(payload: McpTaskOkPayload): CallToolResult {
  return resultFromPayload(payload as unknown as Record<string, unknown>);
}

function errorPayload(payload: McpToolErrorPayload): CallToolResult {
  return {
    ...resultFromPayload(payload as unknown as Record<string, unknown>),
    isError: true,
  };
}

/**
 * Canonical use-case rejections (validation, ownership, scope) map to
 * INVALID_ARGUMENT with the canonical message; transports decide status codes.
 */
function invalidArgumentResult(message: string): CallToolResult {
  return errorPayload({ ok: false, error: { code: "INVALID_ARGUMENT", message } });
}

function unexpectedErrorResult(error: unknown): CallToolResult {
  if (error instanceof McpToolAuthorizationError) {
    return errorPayload({ ok: false, error: { code: error.code, message: error.message } });
  }
  return errorPayload({
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "The MCP tool could not complete the request.",
    },
  });
}

function createActorAndRepository(
  deps: McpWriteModuleDeps,
  authInfo: AuthInfo,
  ownerUserId: string,
): { actor: { userId: string }; repository: SupabaseTasksRepository } {
  return {
    actor: { userId: ownerUserId },
    repository: new SupabaseTasksRepository(deps.createUserClient(authInfo.token)),
  };
}

/**
 * Task write-module handlers for the MCP web transport.
 *
 * Every handler follows the same pipeline: derive the principal from the
 * verified auth context, enforce the grant permission, build the
 * AuthenticatedActor from the principal's ownerUserId, then delegate to the
 * canonical @ega/application task use cases with the Supabase-backed
 * TasksRepository. No product mutation logic lives here: status/priority
 * validation, blocked-reason rules, project/goal ownership, focus invariants,
 * and reminder rules are owned by the canonical services.
 */
export function createTaskMcpWriteHandlers(deps: McpWriteModuleDeps) {
  return {
    async getTask(
      authInfo: AuthInfo | undefined,
      input: { taskId: string },
    ): Promise<CallToolResult> {
      try {
        const principal = requireMcpPermission(authInfo, "tasks.read");
        const { actor, repository } = createActorAndRepository(
          deps,
          authInfo!,
          principal.ownerUserId,
        );
        const result = await getTaskReadModel(actor, repository, input.taskId);
        if (!result.ok) return invalidArgumentResult(result.errorMessage);
        if (!result.data) {
          return errorPayload({ ok: false, error: { code: "NOT_FOUND", message: "Task not found." } });
        }
        return okPayload({ ok: true, task: result.data });
      } catch (error) {
        return unexpectedErrorResult(error);
      }
    },

    async createTask(
      authInfo: AuthInfo | undefined,
      input: {
        title: string;
        projectId: string;
        goalId?: string | null;
        description?: string | null;
        blockedReason?: string | null;
        status?: string;
        priority?: string;
        dueDate?: string | null;
        estimateMinutes?: number | null;
        operationId?: string;
      },
    ): Promise<CallToolResult> {
      try {
        const principal = requireMcpPermission(authInfo, "tasks.create");
        const { actor, repository } = createActorAndRepository(
          deps,
          authInfo!,
          principal.ownerUserId,
        );
        const result = await createTaskService(actor, repository, {
          title: input.title,
          projectId: input.projectId,
          goalId: input.goalId,
          description: input.description,
          blockedReason: input.blockedReason,
          status: input.status,
          priority: input.priority,
          dueDate: input.dueDate,
          estimateMinutes: input.estimateMinutes,
          ...(input.operationId
            ? { mcpOperationId: input.operationId, mcpClientId: principal.oauthClientId }
            : {}),
        });
        if (!result.ok) return invalidArgumentResult(result.errorMessage);
        return okPayload({ ok: true, task: result.data });
      } catch (error) {
        return unexpectedErrorResult(error);
      }
    },

    async updateTask(
      authInfo: AuthInfo | undefined,
      input: {
        taskId: string;
        title?: string;
        description?: string | null;
        blockedReason?: string | null;
        status?: string;
        priority?: string;
        dueDate?: string | null;
        estimateMinutes?: number | null;
        projectId?: string;
        goalId?: string | null;
      },
    ): Promise<CallToolResult> {
      try {
        const principal = requireMcpPermission(authInfo, "tasks.update");
        const { actor, repository } = createActorAndRepository(
          deps,
          authInfo!,
          principal.ownerUserId,
        );
        const result = await updateTaskService(actor, repository, {
          taskId: input.taskId,
          title: input.title,
          description: input.description,
          blockedReason: input.blockedReason,
          status: input.status,
          priority: input.priority,
          dueDate: input.dueDate,
          estimateMinutes: input.estimateMinutes,
          projectId: input.projectId,
          goalId: input.goalId,
        });
        if (!result.ok) return invalidArgumentResult(result.errorMessage);
        return okPayload({ ok: true, task: result.data });
      } catch (error) {
        return unexpectedErrorResult(error);
      }
    },

    async archiveTask(
      authInfo: AuthInfo | undefined,
      input: { taskId: string },
    ): Promise<CallToolResult> {
      try {
        const principal = requireMcpPermission(authInfo, "tasks.update");
        const { actor, repository } = createActorAndRepository(
          deps,
          authInfo!,
          principal.ownerUserId,
        );
        const result = await archiveTaskService(actor, repository, {
          taskId: input.taskId,
        });
        if (!result.ok) return invalidArgumentResult(result.errorMessage);
        return okPayload({ ok: true, task: result.data });
      } catch (error) {
        return unexpectedErrorResult(error);
      }
    },

    async unarchiveTask(
      authInfo: AuthInfo | undefined,
      input: { taskId: string },
    ): Promise<CallToolResult> {
      try {
        const principal = requireMcpPermission(authInfo, "tasks.update");
        const { actor, repository } = createActorAndRepository(
          deps,
          authInfo!,
          principal.ownerUserId,
        );
        const result = await unarchiveTaskService(actor, repository, {
          taskId: input.taskId,
        });
        if (!result.ok) return invalidArgumentResult(result.errorMessage);
        return okPayload({ ok: true, task: result.data });
      } catch (error) {
        return unexpectedErrorResult(error);
      }
    },

    /**
     * Focus-queue changes go through the canonical pin/unpin use cases, which
     * own the next-rank-above-max invariant. Arbitrary rank assignment is not
     * a canonical capability, so this tool only pins (assigns the next rank)
     * or unpins (clears the rank), idempotently.
     */
    async setTaskFocusRank(
      authInfo: AuthInfo | undefined,
      input: { taskId: string; pinned: boolean },
    ): Promise<CallToolResult> {
      try {
        const principal = requireMcpPermission(authInfo, "tasks.update");
        const { actor, repository } = createActorAndRepository(
          deps,
          authInfo!,
          principal.ownerUserId,
        );
        const result = input.pinned
          ? await pinTask(actor, repository, { taskId: input.taskId })
          : await unpinTask(actor, repository, { taskId: input.taskId });
        if (!result.ok) return invalidArgumentResult(result.errorMessage);
        return okPayload({ ok: true, task: result.data.task });
      } catch (error) {
        return unexpectedErrorResult(error);
      }
    },

    async createTaskReminder(
      authInfo: AuthInfo | undefined,
      input: { taskId: string; remindAt: string; operationId?: string },
    ): Promise<CallToolResult> {
      try {
        const principal = requireMcpPermission(authInfo, "tasks.update");
        const { actor, repository } = createActorAndRepository(
          deps,
          authInfo!,
          principal.ownerUserId,
        );
        const result = await createTaskReminderService(actor, repository, {
          taskId: input.taskId,
          remindAt: input.remindAt,
          ...(input.operationId
            ? { mcpOperationId: input.operationId, mcpClientId: principal.oauthClientId }
            : {}),
        });
        if (!result.ok) return invalidArgumentResult(result.errorMessage);
        return okPayload({ ok: true, task: result.data });
      } catch (error) {
        return unexpectedErrorResult(error);
      }
    },

    async cancelTaskReminder(
      authInfo: AuthInfo | undefined,
      input: { taskId: string; reminderId: string },
    ): Promise<CallToolResult> {
      try {
        const principal = requireMcpPermission(authInfo, "tasks.update");
        const { actor, repository } = createActorAndRepository(
          deps,
          authInfo!,
          principal.ownerUserId,
        );
        const result = await cancelTaskReminderService(actor, repository, {
          taskId: input.taskId,
          reminderId: input.reminderId,
        });
        if (!result.ok) return invalidArgumentResult(result.errorMessage);
        return okPayload({ ok: true, task: result.data });
      } catch (error) {
        return unexpectedErrorResult(error);
      }
    },
  };
}
