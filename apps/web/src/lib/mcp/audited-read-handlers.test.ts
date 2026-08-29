import type { CallToolResult } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import {
  createAuditedMcpReadHandlers,
  type AuditedReadHandlerDependencies,
} from "@/lib/mcp/audited-read-handlers";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import type { McpPrincipal } from "@/lib/mcp/principal";

const PRINCIPAL: McpPrincipal = {
  ownerUserId: "00000000-0000-0000-0000-000000000001",
  oauthClientId: "hermes-client",
  grantId: "10000000-0000-0000-0000-000000000001",
  permissionProfile: "read_only",
  permissionsVersion: 1,
  permissions: ["projects.read", "goals.read", "tasks.read", "today.read", "timer.read"],
};

const AUTH_INFO = createMcpAuthInfo("test-bearer", PRINCIPAL);

function successResult(count = 0): CallToolResult {
  return {
    content: [{ type: "text", text: "ok" }],
    structuredContent: { ok: true, count },
  };
}

function errorResult(code: string): CallToolResult {
  return {
    content: [{ type: "text", text: "error" }],
    structuredContent: {
      ok: false,
      error: { code, message: "Stable tool error." },
    },
    isError: true,
  };
}

function createBaseHandlers() {
  return {
    getCapabilities: vi.fn().mockResolvedValue(successResult()),
    listProjects: vi.fn().mockResolvedValue(successResult(3)),
    listGoals: vi.fn().mockResolvedValue(successResult(2)),
    listTasks: vi.fn().mockResolvedValue(successResult(1)),
    getTask: vi.fn().mockResolvedValue(successResult()),
    getTodayPlan: vi.fn().mockResolvedValue(successResult(0)),
    listTimerSessions: vi.fn().mockResolvedValue(successResult(0)),
  };
}

function createDependencies(): AuditedReadHandlerDependencies {
  const values = [100, 112];
  return {
    createUserClient: vi
      .fn()
      .mockReturnValue({ marker: "client" } as unknown as SupabaseClient<McpDatabase>),
    consumeRateLimit: vi.fn().mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    }),
    writeAudit: vi.fn().mockResolvedValue(undefined),
    nowMs: vi.fn(() => values.shift() ?? 112),
    createRequestId: vi.fn(() => "generated-request"),
  };
}

describe("createAuditedMcpReadHandlers", () => {
  it("rate limits and records a successful authenticated tool call", async () => {
    const handlers = createBaseHandlers();
    const dependencies = createDependencies();
    const audited = createAuditedMcpReadHandlers(handlers, dependencies);

    const result = await audited.listProjects(
      AUTH_INFO,
      { limit: 25 },
      { requestId: "request-1" },
    );

    expect(result).toEqual(successResult(3));
    expect(dependencies.createUserClient).toHaveBeenCalledWith("test-bearer");
    expect(dependencies.consumeRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      "ega_list_projects",
    );
    expect(dependencies.writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      {
        principal: PRINCIPAL,
        requestId: "request-1",
        toolName: "ega_list_projects",
        outcome: "success",
        durationMs: 12,
        errorCode: undefined,
        metadata: { resultCount: 3 },
      },
    );
  });

  it("returns and audits a stable denial when the distributed limit is exceeded", async () => {
    const handlers = createBaseHandlers();
    const dependencies = createDependencies();
    vi.mocked(dependencies.consumeRateLimit).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 17,
    });
    const audited = createAuditedMcpReadHandlers(handlers, dependencies);

    const result = await audited.listTasks(AUTH_INFO, { limit: 25 });

    expect(handlers.listTasks).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      ok: false,
      error: {
        code: "RATE_LIMITED",
        message: "EGA House MCP rate limit exceeded.",
      },
      retryAfterSeconds: 17,
    });
    expect(dependencies.writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        toolName: "ega_list_tasks",
        outcome: "denied",
        errorCode: "RATE_LIMITED",
        metadata: { retryAfterSeconds: 17 },
      }),
    );
  });

  it("records a stable error code for failed tool results", async () => {
    const handlers = createBaseHandlers();
    handlers.listTasks.mockResolvedValue(
      errorResult("DEPENDENCY_UNAVAILABLE"),
    );
    const dependencies = createDependencies();
    const audited = createAuditedMcpReadHandlers(handlers, dependencies);

    await audited.listTasks(
      AUTH_INFO,
      { limit: 25 },
      { requestId: 42 },
    );

    expect(dependencies.writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        requestId: "42",
        toolName: "ega_list_tasks",
        outcome: "error",
        errorCode: "DEPENDENCY_UNAVAILABLE",
      }),
    );
  });

  it("rate limits and audits ega_get_task as a read tool", async () => {
    const handlers = createBaseHandlers();
    const dependencies = createDependencies();
    const audited = createAuditedMcpReadHandlers(handlers, dependencies);

    await audited.getTask(AUTH_INFO, { taskId: "task-1" });

    expect(handlers.getTask).toHaveBeenCalledWith(AUTH_INFO, { taskId: "task-1" });
    expect(dependencies.consumeRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      "ega_get_task",
    );
    expect(dependencies.writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ toolName: "ega_get_task", outcome: "success" }),
    );
  });

  it("fails closed when rate limiting is unavailable", async () => {
    const handlers = createBaseHandlers();
    const dependencies = createDependencies();
    vi.mocked(dependencies.consumeRateLimit).mockRejectedValue(
      new Error("Failed to enforce EGA MCP rate limit."),
    );
    const audited = createAuditedMcpReadHandlers(handlers, dependencies);

    const result = await audited.listGoals(AUTH_INFO, { limit: 25 });

    expect(handlers.listGoals).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      ok: false,
      error: {
        code: "DEPENDENCY_UNAVAILABLE",
        message: "EGA House rate limiting is temporarily unavailable.",
      },
    });
  });

  it("uses a generated request ID when the protocol ID is unavailable", async () => {
    const dependencies = createDependencies();
    const audited = createAuditedMcpReadHandlers(
      createBaseHandlers(),
      dependencies,
    );

    await audited.getCapabilities(AUTH_INFO);

    expect(dependencies.createRequestId).toHaveBeenCalledTimes(1);
    expect(dependencies.writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requestId: "generated-request" }),
    );
  });

  it("fails closed when audit persistence fails", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.writeAudit).mockRejectedValue(
      new Error("Failed to persist EGA MCP audit event."),
    );
    const audited = createAuditedMcpReadHandlers(
      createBaseHandlers(),
      dependencies,
    );

    const result = await audited.listGoals(AUTH_INFO, { limit: 25 });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      ok: false,
      error: {
        code: "DEPENDENCY_UNAVAILABLE",
        message: "EGA House audit persistence is temporarily unavailable.",
      },
    });
  });

  it("does not access MCP database guards for malformed auth context", async () => {
    const handlers = createBaseHandlers();
    handlers.listProjects.mockResolvedValue(errorResult("UNAUTHENTICATED"));
    const dependencies = createDependencies();
    const audited = createAuditedMcpReadHandlers(handlers, dependencies);

    const result = await audited.listProjects(
      { token: "test-bearer", clientId: "hermes", scopes: [], extra: {} },
      { limit: 25 },
    );

    expect(result).toEqual(errorResult("UNAUTHENTICATED"));
    expect(dependencies.createUserClient).not.toHaveBeenCalled();
    expect(dependencies.consumeRateLimit).not.toHaveBeenCalled();
    expect(dependencies.writeAudit).not.toHaveBeenCalled();
  });
});
