import type { AuthInfo } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import {
  acceptedContent,
  inputRequired,
} from "@modelcontextprotocol/server";
import {
  canonicalMutationFingerprint,
  claimMcpMutation,
  failMcpMutation,
  storeMcpMutationResult,
} from "@/lib/mcp/mutation-idempotency";
import {
  assertVerifiedMcpMutationState,
  McpMutationStateError,
  mintMcpMutationState,
  type McpMutationBinding,
} from "@/lib/mcp/mrtr-binding";
import {
  createRequestStateCodec,
  getRequestStateSecret,
  McpRequestStateConfigurationError,
} from "@/lib/mcp/request-state";
import {
  createGoal,
  unarchiveGoal,
  updateGoalHealth,
  updateGoalNextStep,
  updateGoalStatus,
  archiveGoal,
} from "@/lib/mcp/write/goals";
import { createMcpTodayWriteHandlers } from "@/lib/mcp/write/today";
import {
  archiveProject,
  createProject,
  unarchiveProject,
  updateProjectStatus,
} from "@/lib/mcp/write/projects";
import { createTaskMcpWriteHandlers } from "@/lib/mcp/write/tasks";
import { createMcpTimerModuleHandlers } from "@/lib/mcp/write/timer";
import {
  McpToolAuthorizationError,
  requireMcpPermission,
} from "@/lib/mcp/tool-authorization";
import { readPrincipalFromAuthInfo } from "@/lib/mcp/auth-info";
import { z } from "zod-v4";

export type McpWriteToolDependencies = {
  createUserClient: (accessToken: string) => SupabaseClient<McpDatabase>;
};

type ToolErrorPayload = {
  ok: false;
  error: { code: string; message: string };
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
    payload = { ok: false, error: { code: error.code, message: error.message } };
  } else if (error instanceof McpMutationStateError) {
    payload = {
      ok: false,
      error: { code: "INVALID_ARGUMENT", message: "MCP confirmation state is missing, invalid, or expired." },
    };
  } else if (error instanceof McpRequestStateConfigurationError) {
    payload = {
      ok: false,
      error: { code: "DEPENDENCY_UNAVAILABLE", message: "EGA MCP confirmation signing is not configured." },
    };
  } else if (error instanceof Error && error.message.includes("writes are disabled")) {
    payload = { ok: false, error: { code: "WRITES_DISABLED", message: error.message } };
  } else if (error instanceof Error && error.message.startsWith("Failed to")) {
    payload = { ok: false, error: { code: "DEPENDENCY_UNAVAILABLE", message: "EGA House data is temporarily unavailable." } };
  } else {
    payload = { ok: false, error: { code: "INTERNAL_ERROR", message: "The MCP tool could not complete the request." } };
  }
  return { ...resultFromPayload(payload as unknown as Record<string, unknown>), isError: true };
}

function assertWritesEnabled(writesEnabled: boolean) {
  if (!writesEnabled) throw new Error("MCP writes are disabled by server configuration (MCP_WRITES_ENABLED).");
}

type McpRequestView = {
  inputResponses?: unknown;
  requestState?: <T>() => T | undefined;
};

function requestViewOf(ctx: unknown): McpRequestView | undefined {
  const view = (ctx as { mcpReq?: McpRequestView } | undefined)?.mcpReq;
  return view ?? undefined;
}

const CONFIRMATION_SCHEMA = z.object({ confirm: z.boolean() });

/**
 * Exclusive-execution wrapper (A1 contract):
 * CLAIM_GRANTED → mutate → store with claim token; handler-reported errors and
 * thrown errors mark FAILED_FINAL so the row is re-claimable; IN_PROGRESS and
 * REPLAY and CONFLICT never mutate. Ledger failures throw (fail closed).
 */

async function withExclusiveMutation(
  client: SupabaseClient<McpDatabase>,
  toolName: string,
  operationId: string,
  semanticInput: Record<string, unknown>,
  mutate: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  const fingerprint = canonicalMutationFingerprint(toolName, semanticInput);
  const claim = await claimMcpMutation(client, toolName, operationId, fingerprint);
  if (claim.outcome === "IN_PROGRESS") {
    return {
      ...resultFromPayload({
        ok: false,
        error: { code: "IN_PROGRESS", message: "This operation is already executing; retry shortly." },
      } as unknown as Record<string, unknown>),
      isError: true,
    };
  }
  if (claim.outcome === "REPLAY") {
    return resultFromPayload(claim.result);
  }
  if (claim.outcome === "CONFLICT") {
    return {
      ...resultFromPayload({
        ok: false,
        error: { code: "CONFLICT", message: "operationId reused with different arguments." },
      } as unknown as Record<string, unknown>),
      isError: true,
    };
  }
  try {
    const result = await mutate();
    if (result.isError) {
      const errorCode = (result.structuredContent as Record<string, unknown> | undefined)?.error as { code?: string } | undefined;
      const code = errorCode?.code;
      const isPermanent = code ? ["INVALID_ARGUMENT", "PERMISSION_DENIED", "CONFLICT", "FAILED_FINAL", "CONFIRMATION_DECLINED", "WRITES_DISABLED"].includes(code) : false;
      await failMcpMutation(client, toolName, operationId, claim.claimToken, isPermanent);
      return result;
    }
    await storeMcpMutationResult(
      client,
      toolName,
      operationId,
      claim.claimToken,
      (result.structuredContent ?? {}) as Record<string, unknown>,
    );
    return result;
  } catch (error) {
    await failMcpMutation(client, toolName, operationId, claim.claimToken, false).catch(() => {});
    throw error;
  }
}

export function createMcpWriteToolHandlers(
  dependencies: McpWriteToolDependencies,
  writesEnabled = false,
  resource = "https://ega.example.com/api/mcp",
) {
  const moduleDeps = {
    createUserClient: dependencies.createUserClient,
  };

  const todayHandlers = createMcpTodayWriteHandlers({
    createUserClient: dependencies.createUserClient,
    clearCompletedMrtr: {
      async firstRound(input, principal) {
        // Fail closed when the signing secret is missing/short: no input_required, no mutation path.
        const secret = getRequestStateSecret();
        const codec = createRequestStateCodec<McpMutationBinding>({ key: secret, ttlSeconds: 300 });
        const argsHash = canonicalMutationFingerprint("ega_clear_completed_today", { date: input.date });
        const requestState = await mintMcpMutationState(codec, {
          user: principal.ownerUserId,
          client: principal.oauthClientId,
          grantId: principal.grantId,
          grantVersion: principal.permissionsVersion,
          resource,
          tool: "ega_clear_completed_today",
          operationId: input.operationId,
          argsHash,
          phase: "awaiting_confirmation",
          targetDate: input.date,
        });
        return inputRequired({
          inputRequests: {
            confirm: inputRequired.elicit({
              message: `Clear completed tasks planned for ${input.date}?`,
              requestedSchema: CONFIRMATION_SCHEMA,
            }),
          },
          requestState,
        }) as unknown;
      },
      async verifySecondRound(ctx, input, principal) {
        const view = requestViewOf(ctx);
        const verifiedState = view?.requestState?.<McpMutationBinding>();
        assertVerifiedMcpMutationState(
          {
            principal: {
              ownerUserId: principal.ownerUserId,
              oauthClientId: principal.oauthClientId,
              grantId: principal.grantId,
              permissionsVersion: principal.permissionsVersion,
            },
            resource,
            tool: "ega_clear_completed_today",
            operationId: input.operationId,
            argsHash: canonicalMutationFingerprint("ega_clear_completed_today", { date: input.date }),
            expectedPhase: "awaiting_confirmation",
            targetDate: input.date,
          },
          verifiedState,
        );
      },
    },
    readVerifiedClearCompletedState: (ctx: unknown) => requestViewOf(ctx)?.requestState?.<McpMutationBinding>(),
  });

  const taskHandlers = createTaskMcpWriteHandlers(moduleDeps);
  const timerHandlers = createMcpTimerModuleHandlers(moduleDeps, writesEnabled);

  return {
    // Projects
    async createProject(
      authInfo: AuthInfo | undefined,
      input: { name: string; slug?: string; description?: string | null; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        requireMcpPermission(authInfo, "projects.create");
        const client = dependencies.createUserClient(authInfo!.token);
        return await withExclusiveMutation(client, "ega_create_project", input.operationId, { name: input.name, slug: input.slug ?? null, description: input.description ?? null }, () =>
          createProject(authInfo, { name: input.name, slug: input.slug ?? null, description: input.description ?? null, operationId: input.operationId }, moduleDeps),
        );
      } catch (error) {
        return errorResult(error);
      }
    },

    async updateProjectStatus(
      authInfo: AuthInfo | undefined,
      input: { projectId: string; status: string; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        requireMcpPermission(authInfo, "projects.update");
        const client = dependencies.createUserClient(authInfo!.token);
        return await withExclusiveMutation(client, "ega_update_project_status", input.operationId, { projectId: input.projectId, status: input.status }, () =>
          updateProjectStatus(authInfo, { projectId: input.projectId, status: input.status }, moduleDeps),
        );
      } catch (error) {
        return errorResult(error);
      }
    },

    async archiveProject(
      authInfo: AuthInfo | undefined,
      input: { projectId: string; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        requireMcpPermission(authInfo, "projects.update");
        const client = dependencies.createUserClient(authInfo!.token);
        return await withExclusiveMutation(client, "ega_archive_project", input.operationId, { projectId: input.projectId }, () =>
          archiveProject(authInfo, { projectId: input.projectId }, moduleDeps),
        );
      } catch (error) {
        return errorResult(error);
      }
    },

    async unarchiveProject(
      authInfo: AuthInfo | undefined,
      input: { projectId: string; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        requireMcpPermission(authInfo, "projects.update");
        const client = dependencies.createUserClient(authInfo!.token);
        return await withExclusiveMutation(client, "ega_unarchive_project", input.operationId, { projectId: input.projectId }, () =>
          unarchiveProject(authInfo, { projectId: input.projectId }, moduleDeps),
        );
      } catch (error) {
        return errorResult(error);
      }
    },

    // Goals
    async createGoal(
      authInfo: AuthInfo | undefined,
      input: { title: string; projectId: string; description?: string | null; status?: string; slug?: string | null; nextStep?: string | null; health?: string | null; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        requireMcpPermission(authInfo, "goals.create");
        const client = dependencies.createUserClient(authInfo!.token);
        return await withExclusiveMutation(client, "ega_create_goal", input.operationId, { title: input.title, projectId: input.projectId, description: input.description ?? null, status: input.status ?? null, slug: input.slug ?? null, nextStep: input.nextStep ?? null, health: input.health ?? null }, () =>
          createGoal(authInfo, { title: input.title, projectId: input.projectId, description: input.description ?? null, status: input.status, slug: input.slug ?? null, nextStep: input.nextStep ?? null, health: input.health ?? null }, moduleDeps),
        );
      } catch (error) {
        return errorResult(error);
      }
    },

    async updateGoalStatus(
      authInfo: AuthInfo | undefined,
      input: { goalId: string; status: string; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        requireMcpPermission(authInfo, "goals.update");
        const client = dependencies.createUserClient(authInfo!.token);
        return await withExclusiveMutation(client, "ega_update_goal_status", input.operationId, { goalId: input.goalId, status: input.status }, () =>
          updateGoalStatus(authInfo, { goalId: input.goalId, status: input.status }, moduleDeps),
        );
      } catch (error) {
        return errorResult(error);
      }
    },

    async updateGoalHealth(
      authInfo: AuthInfo | undefined,
      input: { goalId: string; health: string; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        requireMcpPermission(authInfo, "goals.update");
        const client = dependencies.createUserClient(authInfo!.token);
        return await withExclusiveMutation(client, "ega_update_goal_health", input.operationId, { goalId: input.goalId, health: input.health }, () =>
          updateGoalHealth(authInfo, { goalId: input.goalId, health: input.health }, moduleDeps),
        );
      } catch (error) {
        return errorResult(error);
      }
    },

    async updateGoalNextStep(
      authInfo: AuthInfo | undefined,
      input: { goalId: string; nextStep: string; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        requireMcpPermission(authInfo, "goals.update");
        const client = dependencies.createUserClient(authInfo!.token);
        return await withExclusiveMutation(client, "ega_update_goal_next_step", input.operationId, { goalId: input.goalId, nextStep: input.nextStep }, () =>
          updateGoalNextStep(authInfo, { goalId: input.goalId, nextStep: input.nextStep }, moduleDeps),
        );
      } catch (error) {
        return errorResult(error);
      }
    },

    async archiveGoal(
      authInfo: AuthInfo | undefined,
      input: { goalId: string; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        requireMcpPermission(authInfo, "goals.update");
        const client = dependencies.createUserClient(authInfo!.token);
        return await withExclusiveMutation(client, "ega_archive_goal", input.operationId, { goalId: input.goalId }, () =>
          archiveGoal(authInfo, { goalId: input.goalId }, moduleDeps),
        );
      } catch (error) {
        return errorResult(error);
      }
    },

    async unarchiveGoal(
      authInfo: AuthInfo | undefined,
      input: { goalId: string; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        requireMcpPermission(authInfo, "goals.update");
        const client = dependencies.createUserClient(authInfo!.token);
        return await withExclusiveMutation(client, "ega_unarchive_goal", input.operationId, { goalId: input.goalId }, () =>
          unarchiveGoal(authInfo, { goalId: input.goalId }, moduleDeps),
        );
      } catch (error) {
        return errorResult(error);
      }
    },

    // Tasks (read via canonical task read model)
    async getTask(
      authInfo: AuthInfo | undefined,
      input: { taskId: string },
    ): Promise<CallToolResult> {
      try {
        return await taskHandlers.getTask(authInfo, { taskId: input.taskId });
      } catch (error) {
        return errorResult(error);
      }
    },

    async createTask(
      authInfo: AuthInfo | undefined,
      input: { title: string; projectId: string; goalId?: string | null; description?: string | null; blockedReason?: string | null; status?: string; priority?: string; dueDate?: string | null; estimateMinutes?: number | null; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        requireMcpPermission(authInfo, "tasks.create");
        const client = dependencies.createUserClient(authInfo!.token);
        const semantic = { title: input.title, projectId: input.projectId, goalId: input.goalId ?? null, description: input.description ?? null, blockedReason: input.blockedReason ?? null, status: input.status ?? null, priority: input.priority ?? null, dueDate: input.dueDate ?? null, estimateMinutes: input.estimateMinutes ?? null };
        return await withExclusiveMutation(client, "ega_create_task", input.operationId, semantic, () =>
          taskHandlers.createTask(authInfo, {
            title: input.title,
            projectId: input.projectId,
            goalId: input.goalId ?? null,
            description: input.description ?? null,
            blockedReason: input.blockedReason ?? null,
            status: input.status,
            priority: input.priority,
            dueDate: input.dueDate ?? null,
            estimateMinutes: input.estimateMinutes ?? null,
          }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },

    async updateTask(
      authInfo: AuthInfo | undefined,
      input: { taskId: string; title?: string; description?: string | null; blockedReason?: string | null; status?: string; priority?: string; dueDate?: string | null; estimateMinutes?: number | null; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        requireMcpPermission(authInfo, "tasks.update");
        const client = dependencies.createUserClient(authInfo!.token);
        const semantic = { taskId: input.taskId, title: input.title ?? null, description: input.description ?? null, blockedReason: input.blockedReason ?? null, status: input.status ?? null, priority: input.priority ?? null, dueDate: input.dueDate ?? null, estimateMinutes: input.estimateMinutes ?? null };
        return await withExclusiveMutation(client, "ega_update_task", input.operationId, semantic, () =>
          taskHandlers.updateTask(authInfo, {
            taskId: input.taskId,
            title: input.title,
            description: input.description ?? null,
            blockedReason: input.blockedReason ?? null,
            status: input.status,
            priority: input.priority,
            dueDate: input.dueDate ?? null,
            estimateMinutes: input.estimateMinutes ?? null,
          }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },

    async archiveTask(
      authInfo: AuthInfo | undefined,
      input: { taskId: string; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        requireMcpPermission(authInfo, "tasks.update");
        const client = dependencies.createUserClient(authInfo!.token);
        return await withExclusiveMutation(client, "ega_archive_task", input.operationId, { taskId: input.taskId }, () =>
          taskHandlers.archiveTask(authInfo, { taskId: input.taskId }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },

    async unarchiveTask(
      authInfo: AuthInfo | undefined,
      input: { taskId: string; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        requireMcpPermission(authInfo, "tasks.update");
        const client = dependencies.createUserClient(authInfo!.token);
        return await withExclusiveMutation(client, "ega_unarchive_task", input.operationId, { taskId: input.taskId }, () =>
          taskHandlers.unarchiveTask(authInfo, { taskId: input.taskId }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },

    async setTaskFocusRank(
      authInfo: AuthInfo | undefined,
      input: { taskId: string; pinned: boolean; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        requireMcpPermission(authInfo, "tasks.update");
        const client = dependencies.createUserClient(authInfo!.token);
        return await withExclusiveMutation(client, "ega_set_task_focus_rank", input.operationId, { taskId: input.taskId, pinned: input.pinned }, () =>
          taskHandlers.setTaskFocusRank(authInfo, { taskId: input.taskId, pinned: input.pinned }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },

    async createTaskReminder(
      authInfo: AuthInfo | undefined,
      input: { taskId: string; remindAt: string; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        requireMcpPermission(authInfo, "tasks.update");
        const client = dependencies.createUserClient(authInfo!.token);
        return await withExclusiveMutation(client, "ega_create_task_reminder", input.operationId, { taskId: input.taskId, remindAt: input.remindAt }, () =>
          taskHandlers.createTaskReminder(authInfo, { taskId: input.taskId, remindAt: input.remindAt }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },

    async cancelTaskReminder(
      authInfo: AuthInfo | undefined,
      input: { taskId: string; reminderId: string; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        requireMcpPermission(authInfo, "tasks.update");
        const client = dependencies.createUserClient(authInfo!.token);
        return await withExclusiveMutation(client, "ega_cancel_task_reminder", input.operationId, { taskId: input.taskId, reminderId: input.reminderId }, () =>
          taskHandlers.cancelTaskReminder(authInfo, { taskId: input.taskId, reminderId: input.reminderId }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },

    // Today (projection over tasks)
    async planTaskForToday(
      authInfo: AuthInfo | undefined,
      input: { taskId: string; date: string; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        requireMcpPermission(authInfo, "today.update");
        const client = dependencies.createUserClient(authInfo!.token);
        return await withExclusiveMutation(client, "ega_plan_task_for_today", input.operationId, { taskId: input.taskId, date: input.date }, () =>
          todayHandlers.planTaskForToday(authInfo, { taskId: input.taskId, date: input.date }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },

    async removeTaskFromToday(
      authInfo: AuthInfo | undefined,
      input: { taskId: string; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        requireMcpPermission(authInfo, "today.update");
        const client = dependencies.createUserClient(authInfo!.token);
        return await withExclusiveMutation(client, "ega_remove_task_from_today", input.operationId, { taskId: input.taskId }, () =>
          todayHandlers.removeTaskFromToday(authInfo, { taskId: input.taskId }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },

    async updateTodayTaskStatus(
      authInfo: AuthInfo | undefined,
      input: { taskId: string; status: string; blockedReason?: string | null; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        requireMcpPermission(authInfo, "today.update");
        const client = dependencies.createUserClient(authInfo!.token);
        return await withExclusiveMutation(client, "ega_update_today_task_status", input.operationId, { taskId: input.taskId, status: input.status, blockedReason: input.blockedReason ?? null }, () =>
          todayHandlers.updateTodayTaskStatus(authInfo, { taskId: input.taskId, status: input.status, blockedReason: input.blockedReason ?? null }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },

    /**
     * MRTR-protected destructive clear. Round 1 (no verified state) returns a
     * real `input_required` without claiming or mutating. Round 2 requires the
     * SDK-verified requestState to match the full authorization binding AND an
     * explicit accepted `confirm` — a declined or cancelled answer NEVER
     * mutates (fail closed).
     */
    async clearCompletedToday(
      authInfo: AuthInfo | undefined,
      input: { date: string; operationId: string },
      ctx?: unknown,
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        const principal = requireMcpPermission(authInfo, "today.update");
        const view = requestViewOf(ctx);
        const verifiedState = view?.requestState?.<McpMutationBinding>();
        if (!verifiedState) {
          // Round 1 — no claim, no mutation.
          return await todayHandlers.clearCompletedToday(authInfo, input, ctx);
        }
        assertVerifiedMcpMutationState(
          {
            principal: {
              ownerUserId: principal.ownerUserId,
              oauthClientId: principal.oauthClientId,
              grantId: principal.grantId,
              permissionsVersion: principal.permissionsVersion,
            },
            resource,
            tool: "ega_clear_completed_today",
            operationId: input.operationId,
            argsHash: canonicalMutationFingerprint("ega_clear_completed_today", { date: input.date }),
            expectedPhase: "awaiting_confirmation",
            targetDate: input.date,
          },
          verifiedState,
        );
        const confirmed = acceptedContent(
          view?.inputResponses as Record<string, unknown>,
          "confirm",
          CONFIRMATION_SCHEMA,
        ) as { confirm?: boolean } | undefined;
        if (!confirmed || confirmed.confirm !== true) {
          // Declined / cancelled / missing → zero mutation, fail closed.
          return {
            ...resultFromPayload({
              ok: false,
              error: { code: "CONFIRMATION_DECLINED", message: "The operator declined this destructive operation; nothing was changed." },
            } as unknown as Record<string, unknown>),
            isError: true,
          };
        }
        const client = dependencies.createUserClient(authInfo!.token);
        return await withExclusiveMutation(client, "ega_clear_completed_today", input.operationId, { date: input.date }, () =>
          todayHandlers.clearCompletedToday(authInfo, input, ctx),
        );
      } catch (error) {
        return errorResult(error);
      }
    },

    // Timer
    async startTimer(
      authInfo: AuthInfo | undefined,
      input: { taskId: string; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        requireMcpPermission(authInfo, "timer.create");
        const client = dependencies.createUserClient(authInfo!.token);
        return await withExclusiveMutation(client, "ega_start_timer", input.operationId, { taskId: input.taskId }, () =>
          timerHandlers.startTimer(authInfo, { taskId: input.taskId }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },

    async stopTimer(
      authInfo: AuthInfo | undefined,
      input: { sessionId: string; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        requireMcpPermission(authInfo, "timer.update");
        const client = dependencies.createUserClient(authInfo!.token);
        return await withExclusiveMutation(client, "ega_stop_timer", input.operationId, { sessionId: input.sessionId }, () =>
          timerHandlers.stopTimer(authInfo, { sessionId: input.sessionId }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  };
}
