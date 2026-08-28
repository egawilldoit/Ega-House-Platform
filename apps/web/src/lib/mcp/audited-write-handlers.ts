import { randomUUID } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { writeMcpAuditEvent } from "@/lib/mcp/audit-repository";
import { readPrincipalFromAuthInfo } from "@/lib/mcp/auth-info";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import { consumeMcpRateLimit } from "@/lib/mcp/rate-limit-repository";
import type { createMcpWriteToolHandlers } from "@/lib/mcp/write-tool-handlers";

type BaseWriteHandlers = ReturnType<typeof createMcpWriteToolHandlers>;

type ProtocolContext = { requestId?: string | number };

export type AuditedWriteHandlerDependencies = {
  createUserClient: (accessToken: string) => SupabaseClient<McpDatabase>;
  consumeRateLimit: typeof consumeMcpRateLimit;
  writeAudit: typeof writeMcpAuditEvent;
  nowMs: () => number;
  createRequestId: () => string;
};

function getOutcome(result: CallToolResult) {
  if (!result.isError) return "success" as const;
  const err = (result.structuredContent as { error?: { code?: string } })?.error?.code;
  if (err === "RATE_LIMITED" || err === "PERMISSION_DENIED" || err === "CONFLICT" || err === "INPUT_REQUIRED") return "denied" as const;
  return "error" as const;
}

export function createAuditedMcpWriteHandlers(
  handlers: BaseWriteHandlers,
  deps: AuditedWriteHandlerDependencies = {
    createUserClient: () => { throw new Error("not configured"); },
    consumeRateLimit: consumeMcpRateLimit,
    writeAudit: writeMcpAuditEvent,
    nowMs: () => performance.now(),
    createRequestId: randomUUID,
  },
) {
  async function execute(
    toolName: string,
    authInfo: AuthInfo | undefined,
    context: ProtocolContext | undefined,
    call: () => Promise<CallToolResult>,
  ): Promise<CallToolResult> {
    let principal;
    try {
      if (!authInfo) return await call();
      principal = readPrincipalFromAuthInfo(authInfo);
    } catch {
      return await call();
    }
    const client = deps.createUserClient(authInfo.token);
    const started = deps.nowMs();
    let result: CallToolResult;
    try {
      const rate = await deps.consumeRateLimit(client, toolName);
      if (!rate.allowed) {
        result = {
          content: [{ type: "text", text: JSON.stringify({ ok: false, error: { code: "RATE_LIMITED", message: "Rate limit exceeded", retryAfterSeconds: rate.retryAfterSeconds } }) }],
          structuredContent: { ok: false, error: { code: "RATE_LIMITED" }, retryAfterSeconds: rate.retryAfterSeconds },
          isError: true,
        } as CallToolResult;
      } else {
        result = await call();
      }
    } catch {
      result = {
        content: [{ type: "text", text: JSON.stringify({ ok: false, error: { code: "DEPENDENCY_UNAVAILABLE" } }) }],
        structuredContent: { ok: false, error: { code: "DEPENDENCY_UNAVAILABLE" } },
        isError: true,
      } as CallToolResult;
    }
    const ended = deps.nowMs();
    const outcome = getOutcome(result);
    // Mutation-safe: audit failure should not cause client to see failure and retry duplicating (ledger already protects)
    // So we write audit but if it fails, we still return the mutation result (ledger holds it)
    try {
      await deps.writeAudit(client, {
        principal,
        requestId: (context?.requestId?.toString().slice(0,64) ?? deps.createRequestId().slice(0,64)),
        toolName,
        outcome,
        durationMs: Math.max(0, Math.round(ended - started)),
        errorCode: outcome === "error" ? "INTERNAL_ERROR" : undefined,
        metadata: {},
      });
    } catch (auditError) {
      // Mutation already durable via ledger, but audit failure is observable via operational logging
      console.error("[mcp-audit] failed to persist audit event", { toolName, outcome, error: String(auditError) });
    }
    return result;
  }

  return {
    createProject: (a: AuthInfo | undefined, i: Parameters<BaseWriteHandlers["createProject"]>[1], c?: ProtocolContext) => execute("ega_create_project", a, c, () => handlers.createProject(a, i)),
    updateProjectStatus: (a: AuthInfo | undefined, i: Parameters<BaseWriteHandlers["updateProjectStatus"]>[1], c?: ProtocolContext) => execute("ega_update_project_status", a, c, () => handlers.updateProjectStatus(a, i)),
    createGoal: (a: AuthInfo | undefined, i: Parameters<BaseWriteHandlers["createGoal"]>[1], c?: ProtocolContext) => execute("ega_create_goal", a, c, () => handlers.createGoal(a, i)),
    createTask: (a: AuthInfo | undefined, i: Parameters<BaseWriteHandlers["createTask"]>[1], c?: ProtocolContext) => execute("ega_create_task", a, c, () => handlers.createTask(a, i)),
    updateTask: (a: AuthInfo | undefined, i: Parameters<BaseWriteHandlers["updateTask"]>[1], c?: ProtocolContext) => execute("ega_update_task", a, c, () => handlers.updateTask(a, i)),
    planTaskForToday: (a: AuthInfo | undefined, i: Parameters<BaseWriteHandlers["planTaskForToday"]>[1], c?: ProtocolContext) => execute("ega_plan_task_for_today", a, c, () => handlers.planTaskForToday(a, i)),
    startTimer: (a: AuthInfo | undefined, i: Parameters<BaseWriteHandlers["startTimer"]>[1], c?: ProtocolContext) => execute("ega_start_timer", a, c, () => handlers.startTimer(a, i)),
    stopTimer: (a: AuthInfo | undefined, i: Parameters<BaseWriteHandlers["stopTimer"]>[1], c?: ProtocolContext) => execute("ega_stop_timer", a, c, () => handlers.stopTimer(a, i)),
    clearCompletedToday: (a: AuthInfo | undefined, i: Parameters<BaseWriteHandlers["clearCompletedToday"]>[1], c?: ProtocolContext & { mcpReq?: unknown }) => execute("ega_clear_completed_today", a, c as unknown as ProtocolContext, () => handlers.clearCompletedToday(a, i, c as unknown as never)),
  };
}
