import { randomUUID } from "node:crypto";

import type { AuthInfo } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  writeMcpAuditEvent,
  type McpAuditEventInput,
} from "@/lib/mcp/audit-repository";
import { readPrincipalFromAuthInfo } from "@/lib/mcp/auth-info";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import {
  consumeMcpRateLimit,
  type McpRateLimitResult,
} from "@/lib/mcp/rate-limit-repository";
import type { createMcpReadToolHandlers } from "@/lib/mcp/read-tool-handlers";

type BaseReadHandlers = ReturnType<typeof createMcpReadToolHandlers>;

type ProtocolContext = {
  requestId?: string | number;
};

export type AuditedReadHandlerDependencies = {
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

function auditUnavailableResult(): CallToolResult {
  return stableErrorResult(
    "DEPENDENCY_UNAVAILABLE",
    "EGA House audit persistence is temporarily unavailable.",
  );
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

function getResultCount(result: CallToolResult): number | undefined {
  const structured = result.structuredContent;
  if (!isRecord(structured)) return undefined;
  const count = structured.count;
  return typeof count === "number" && Number.isInteger(count) && count >= 0
    ? count
    : undefined;
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

function buildAuditMetadata(
  resultCount: number | undefined,
  retryAfterSeconds: number | undefined,
): NonNullable<McpAuditEventInput["metadata"]> {
  if (resultCount !== undefined) return { resultCount };
  if (retryAfterSeconds !== undefined) return { retryAfterSeconds };
  return {};
}

const DEFAULT_DEPENDENCIES: AuditedReadHandlerDependencies = {
  createUserClient: () => {
    throw new Error("MCP audit user client dependency is not configured.");
  },
  consumeRateLimit: consumeMcpRateLimit,
  writeAudit: writeMcpAuditEvent,
  nowMs: () => performance.now(),
  createRequestId: randomUUID,
};

export function createAuditedMcpReadHandlers(
  handlers: BaseReadHandlers,
  dependencies: AuditedReadHandlerDependencies = DEFAULT_DEPENDENCIES,
) {
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
    const metadata = buildAuditMetadata(
      getResultCount(result),
      getRetryAfterSeconds(result),
    );
    const auditInput: McpAuditEventInput = {
      principal,
      requestId: normalizeRequestId(context, dependencies.createRequestId),
      toolName,
      outcome: getOutcome(result, errorCode),
      durationMs: durationMs(startedAt, endedAt),
      errorCode,
      metadata,
    };

    try {
      await dependencies.writeAudit(client, auditInput);
    } catch {
      return auditUnavailableResult();
    }

    return result;
  }

  return {
    getCapabilities(
      authInfo: AuthInfo | undefined,
      context?: ProtocolContext,
    ): Promise<CallToolResult> {
      return execute(
        "ega_get_capabilities",
        authInfo,
        context,
        () => handlers.getCapabilities(authInfo),
      );
    },

    listProjects(
      authInfo: AuthInfo | undefined,
      input: Parameters<BaseReadHandlers["listProjects"]>[1],
      context?: ProtocolContext,
    ): Promise<CallToolResult> {
      return execute(
        "ega_list_projects",
        authInfo,
        context,
        () => handlers.listProjects(authInfo, input),
      );
    },

    listGoals(
      authInfo: AuthInfo | undefined,
      input: Parameters<BaseReadHandlers["listGoals"]>[1],
      context?: ProtocolContext,
    ): Promise<CallToolResult> {
      return execute(
        "ega_list_goals",
        authInfo,
        context,
        () => handlers.listGoals(authInfo, input),
      );
    },

    listTasks(
      authInfo: AuthInfo | undefined,
      input: Parameters<BaseReadHandlers["listTasks"]>[1],
      context?: ProtocolContext,
    ): Promise<CallToolResult> {
      return execute(
        "ega_list_tasks",
        authInfo,
        context,
        () => handlers.listTasks(authInfo, input),
      );
    },

    getTodayPlan(
      authInfo: AuthInfo | undefined,
      input: Parameters<BaseReadHandlers["getTodayPlan"]>[1],
      context?: ProtocolContext,
    ): Promise<CallToolResult> {
      return execute(
        "ega_get_today_plan",
        authInfo,
        context,
        () => handlers.getTodayPlan(authInfo, input),
      );
    },

    listTimerSessions(
      authInfo: AuthInfo | undefined,
      input: Parameters<BaseReadHandlers["listTimerSessions"]>[1],
      context?: ProtocolContext,
    ): Promise<CallToolResult> {
      return execute(
        "ega_list_timer_sessions",
        authInfo,
        context,
        () => handlers.listTimerSessions(authInfo, input),
      );
    },
  };
}
