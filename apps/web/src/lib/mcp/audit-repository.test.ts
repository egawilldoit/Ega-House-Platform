import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { writeMcpAuditEvent } from "@/lib/mcp/audit-repository";

const PRINCIPAL: McpPrincipal = {
  ownerUserId: "00000000-0000-0000-0000-000000000001",
  oauthClientId: "test-mcp-client",
  grantId: "10000000-0000-0000-0000-000000000001",
  permissionProfile: "read_only",
  permissionsVersion: 1,
  permissions: ["projects.read", "goals.read", "tasks.read"],
};

function createClient(result: { error: unknown }) {
  const insert = vi.fn().mockResolvedValue(result);
  const from = vi.fn().mockReturnValue({ insert });
  return {
    client: { from } as unknown as SupabaseClient<McpDatabase>,
    from,
    insert,
  };
}

describe("writeMcpAuditEvent", () => {
  it("writes a successful token-free MCP invocation event", async () => {
    const mock = createClient({ error: null });

    await expect(
      writeMcpAuditEvent(mock.client, {
        principal: PRINCIPAL,
        requestId: "request-1",
        toolName: "ega_list_projects",
        outcome: "success",
        durationMs: 12,
        metadata: { resultCount: 3 },
      }),
    ).resolves.toBeUndefined();

    expect(mock.from).toHaveBeenCalledWith("agent_integration_events");
    expect(mock.insert).toHaveBeenCalledWith({
      owner_user_id: PRINCIPAL.ownerUserId,
      token_id: null,
      oauth_client_id: PRINCIPAL.oauthClientId,
      grant_id: PRINCIPAL.grantId,
      action: "mcp_tool_call",
      resource_type: "mcp_tool",
      resource_id: null,
      outcome: "success",
      ip_address: null,
      request_id: "request-1",
      tool_name: "ega_list_projects",
      metadata: { resultCount: 3 },
      duration_ms: 12,
      error_code: null,
    });
  });

  it("writes stable failure information without exception details", async () => {
    const mock = createClient({ error: null });

    await writeMcpAuditEvent(mock.client, {
      principal: PRINCIPAL,
      requestId: "request-2",
      toolName: "ega_list_tasks",
      outcome: "error",
      durationMs: 4,
      errorCode: "DEPENDENCY_UNAVAILABLE",
    });

    expect(mock.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "error",
        error_code: "DEPENDENCY_UNAVAILABLE",
        metadata: {},
      }),
    );
  });

  it("rejects negative or non-integer durations before writing", async () => {
    const mock = createClient({ error: null });

    await expect(
      writeMcpAuditEvent(mock.client, {
        principal: PRINCIPAL,
        requestId: "request-3",
        toolName: "ega_list_tasks",
        outcome: "success",
        durationMs: -1,
      }),
    ).rejects.toThrow("MCP audit duration must be a non-negative integer.");
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("redacts database write errors", async () => {
    const mock = createClient({
      error: { message: "sensitive database detail" },
    });

    await expect(
      writeMcpAuditEvent(mock.client, {
        principal: PRINCIPAL,
        requestId: "request-4",
        toolName: "ega_list_tasks",
        outcome: "success",
        durationMs: 1,
      }),
    ).rejects.toThrow("Failed to persist EGA MCP audit event.");
  });
});
