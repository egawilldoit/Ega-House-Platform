import { randomUUID } from "node:crypto";

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  writeMcpAuditEvent,
  type McpAuditEventInput,
} from "@/lib/mcp/audit-repository";
import { readPrincipalFromAuthInfo } from "@/lib/mcp/auth-info";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import type { createMcpReadToolHandlers } from "@/lib/mcp/read-tool-handlers";

type BaseReadHandlers = ReturnType<typeof createMcpReadToolHandlers>;

type ProtocolContext = {
  requestId?: string | number;
};

export type AuditedReadHandlerDependencies = {
  createUserClient: (accessToken: string) => SupabaseClient<McpDatabase>;
  writeAudit: typeof writeMcpAuditEvent;
  nowMs: () => number;
  createRequestId: () => string;
};

function auditUnavailableResult(): CallToolResult {
  const payload = {
    ok: false,
    error: {
      code: "DEPENDENCY_UNAVAILABLE",
      message: "EGA House audit persistence is temporarily unavailable.",
    },
  };

  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getResultCount(result: CallToolResult): number | undefined {
  const structured = result.structuredContent;
  if (!isRecord(structured)) return undefined;
  const count = structured.count;
  return typeof count === "number" && Number.isInteger(count) && count >= 0
    ? count
    : undefined;
}

function getErrorCode(result: CallToolResult): string | undefined {
  if (!result.isError || !isRecord(result.structuredContent)) return undefined;
  const error = result.structuredContent.error;
  if (!isRecord(error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
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

const DEFAULT_DEPENDENCIES: AuditedReadHandlerDependencies = {
  createUserClient: () => {
    throw new Error("MCP audit user client dependency is not configured.");
  },
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
    const result = await callTool();
    const endedAt = dependencies.nowMs();
    const errorCode = getErrorCode(result);
    const resultCount = getResultCount(result);
    const auditInput: McpAuditEventInput = {
      principal,
      requestId: normalizeRequestId(context, dependencies.createRequestId),
      toolName,
      outcome: result.isError ? "error" : "success",
      durationMs: durationMs(startedAt, endedAt),
      errorCode,
      metadata:
        resultCount === undefined ? {} : { resultCount },
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
  };
}
