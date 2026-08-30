import { randomUUID } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { writeMcpAuditEvent, type McpAuditEventInput } from "@/lib/mcp/audit-repository";
import { readPrincipalFromAuthInfo } from "@/lib/mcp/auth-info";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import { consumeMcpRateLimit, type McpRateLimitResult } from "@/lib/mcp/rate-limit-repository";
import type { McpWriteToolHandlers } from "@/lib/mcp/server";

type ProtocolContext = {
  requestId?: string | number;
};

export type AuditedWriteHandlerDependencies = {
  createUserClient: (accessToken: string) => SupabaseClient<McpDatabase>;
  consumeRateLimit: (
    client: SupabaseClient<McpDatabase>,
    toolName: string,
  ) => Promise<McpRateLimitResult>;
  writeAudit: typeof writeMcpAuditEvent;
  nowMs: () => number;
  createRequestId: () => string;
};

function stableErrorResult(
  code: "DEPENDENCY_UNAVAILABLE" | "RATE_LIMITED",
  message: string,
  extra: Record<string, unknown> = {},
): CallToolResult {
  const payload = {
    ok: false,
    error: { code, message },
    ...extra,
  };

  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: true,
  };
}

function rateLimitUnavailableResult(): CallToolResult {
  return stableErrorResult(
    "DEPENDENCY_UNAVAILABLE",
    "EGA House rate limiting is temporarily unavailable.",
  );
}

function rateLimitedResult(retryAfterSeconds: number): CallToolResult {
  return stableErrorResult(
    "RATE_LIMITED",
    "EGA House MCP rate limit exceeded.",
    { retryAfterSeconds },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getRetryAfterSeconds(result: CallToolResult): number | undefined {
  const structured = result.structuredContent;
  if (!isRecord(structured)) return undefined;
  const value = structured.retryAfterSeconds;
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function getErrorCode(result: CallToolResult): string | undefined {
  if (!result.isError || !isRecord(result.structuredContent)) return undefined;
  const error = result.structuredContent.error;
  if (!isRecord(error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function getOutcome(result: CallToolResult, errorCode: string | undefined) {
  if (!result.isError) return "success" as const;
  if (errorCode === "RATE_LIMITED" || errorCode === "PERMISSION_DENIED") {
    return "denied" as const;
  }
  return "error" as const;
}

function normalizeRequestId(
  context: ProtocolContext | undefined,
  createRequestId: () => string,
): string {
  const requestId = context?.requestId;
  if (typeof requestId === "string" && requestId.trim() !== "") {
    return requestId.slice(0, 64);
  }
  if (typeof requestId === "number" && Number.isFinite(requestId)) {
    return String(requestId).slice(0, 64);
  }
  return createRequestId().slice(0, 64);
}

function durationMs(start: number, end: number): number {
  return Math.max(0, Math.round(end - start));
}

/**
 * Mutation-safe audit: a failed audit write is logged but never converted into
 * a client-visible error, because the idempotency ledger already holds the
 * durable mutation result — surfacing an error would invite a duplicate retry.
 */
function buildAuditMetadata(
  result: CallToolResult,
): NonNullable<McpAuditEventInput["metadata"]> {
  const retryAfterSeconds = getRetryAfterSeconds(result);
  if (retryAfterSeconds !== undefined) return { retryAfterSeconds };
  return {};
}

const DEFAULT_DEPENDENCIES: AuditedWriteHandlerDependencies = {
  createUserClient: () => {
    throw new Error("MCP audit user client dependency is not configured.");
  },
  consumeRateLimit: consumeMcpRateLimit,
  writeAudit: writeMcpAuditEvent,
  nowMs: () => performance.now(),
  createRequestId: randomUUID,
};

/** toolName per handler method — single source of truth for audit labels. */
const HANDLER_TOOL_NAMES: Readonly<Record<keyof McpWriteToolHandlers, string>> = {
  createProject: "ega_create_project",
  updateProjectStatus: "ega_update_project_status",
  archiveProject: "ega_archive_project",
  unarchiveProject: "ega_unarchive_project",
  createGoal: "ega_create_goal",
  updateGoalStatus: "ega_update_goal_status",
  updateGoalHealth: "ega_update_goal_health",
  updateGoalNextStep: "ega_update_goal_next_step",
  archiveGoal: "ega_archive_goal",
  unarchiveGoal: "ega_unarchive_goal",
  getTask: "ega_get_task",
  createTask: "ega_create_task",
  updateTask: "ega_update_task",
  archiveTask: "ega_archive_task",
  unarchiveTask: "ega_unarchive_task",
  setTaskFocusRank: "ega_set_task_focus_rank",
  createTaskReminder: "ega_create_task_reminder",
  cancelTaskReminder: "ega_cancel_task_reminder",
  planTaskForToday: "ega_plan_task_for_today",
  removeTaskFromToday: "ega_remove_task_from_today",
  updateTodayTaskStatus: "ega_update_today_task_status",
  startTimer: "ega_start_timer",
  stopTimer: "ega_stop_timer",
  clearCompletedToday: "ega_clear_completed_today",
};

type WriteHandlerMethod = (authInfo: AuthInfo | undefined, input: never, context?: unknown) => Promise<CallToolResult>;

export function createAuditedMcpWriteHandlers(
  handlers: McpWriteToolHandlers,
  dependencies: AuditedWriteHandlerDependencies = DEFAULT_DEPENDENCIES,
): McpWriteToolHandlers {
  async function execute(
    toolName: string,
    authInfo: AuthInfo | undefined,
    context: ProtocolContext | undefined,
    callTool: () => Promise<CallToolResult>,
  ): Promise<CallToolResult> {
    let principal;
    try {
      if (!authInfo) return await callTool();
      principal = readPrincipalFromAuthInfo(authInfo);
    } catch {
      return await callTool();
    }

    const client = dependencies.createUserClient(authInfo.token);
    const startedAt = dependencies.nowMs();
    let result: CallToolResult;

    try {
      const rateLimit = await dependencies.consumeRateLimit(client, toolName);
      result = rateLimit.allowed
        ? await callTool()
        : rateLimitedResult(rateLimit.retryAfterSeconds);
    } catch {
      result = rateLimitUnavailableResult();
    }

    const endedAt = dependencies.nowMs();
    const errorCode = getErrorCode(result);
    const auditInput: McpAuditEventInput = {
      principal,
      requestId: normalizeRequestId(context, dependencies.createRequestId),
      toolName,
      outcome: getOutcome(result, errorCode),
      durationMs: durationMs(startedAt, endedAt),
      errorCode,
      metadata: buildAuditMetadata(result),
    };

    try {
      await dependencies.writeAudit(client, auditInput);
    } catch (auditError) {
      console.error("[mcp-audit] failed to persist write audit event", {
        toolName,
        outcome: auditInput.outcome,
        error: auditError instanceof Error ? auditError.message : String(auditError),
      });
    }

    return result;
  }

  const wrapped = {} as Record<keyof McpWriteToolHandlers, WriteHandlerMethod>;
  for (const method of Object.keys(HANDLER_TOOL_NAMES) as (keyof McpWriteToolHandlers)[]) {
    const toolName = HANDLER_TOOL_NAMES[method];
    const original = handlers[method].bind(handlers) as WriteHandlerMethod;
    wrapped[method] = (authInfo, input, context) =>
      execute(toolName, authInfo, context as ProtocolContext | undefined, () =>
        original(authInfo, input, context),
      );
  }
  return wrapped as unknown as McpWriteToolHandlers;
}
