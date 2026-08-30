import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { writeMcpAuditEvent } from "@/lib/mcp/audit-repository";

const PRINCIPAL: McpPrincipal = {
  ownerUserId: "00000000-0000-0000-0000-000000000001",
  oauthClientId: "hermes-client",
  grantId: "10000000-0000-0000-0000-000000000001",
  permissionProfile: "read_only",
  permissionsVersion: 1,
  permissions: ["projects.read", "goals.read", "tasks.read"],
};

function createClient(result: { data?: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return {
    client: { rpc } as unknown as SupabaseClient<McpDatabase>,
    rpc,
  };
}

describe("writeMcpAuditEvent", () => {
  it("writes a successful token-free MCP invocation event", async () => {
    const mock = createClient({ data: "20000000-0000-0000-0000-000000000001", error: null });

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

    expect(mock.rpc).toHaveBeenCalledWith("record_mcp_audit_event", {
      p_request_id: "request-1",
      p_tool_name: "ega_list_projects",
      p_outcome: "success",
      p_duration_ms: 12,
      p_error_code: null,
      p_metadata: { resultCount: 3 },
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

    expect(mock.rpc).toHaveBeenCalledWith("record_mcp_audit_event", expect.objectContaining({
      p_outcome: "error",
      p_error_code: "DEPENDENCY_UNAVAILABLE",
      p_metadata: {},
    }));
  });

  it("does not send caller-controlled principal identity to the RPC", async () => {
    const mock = createClient({ data: "20000000-0000-0000-0000-000000000002", error: null });

    await writeMcpAuditEvent(mock.client, {
      principal: PRINCIPAL,
      requestId: "request-identity",
      toolName: "ega_list_tasks",
      outcome: "success",
      durationMs: 1,
    });

    expect(mock.rpc.mock.calls[0]?.[1]).not.toEqual(expect.objectContaining({
      owner_user_id: expect.anything(),
      oauth_client_id: expect.anything(),
      grant_id: expect.anything(),
      resource_uri: expect.anything(),
    }));
    expect(mock.rpc.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      p_request_id: "request-identity",
      p_tool_name: "ega_list_tasks",
      p_outcome: "success",
    }));
  });

  it("rejects an RPC failure without exposing database details", async () => {
    const mock = createClient({
      error: { message: "permission denied: sensitive database detail" },
    });

    await expect(
      writeMcpAuditEvent(mock.client, {
        principal: PRINCIPAL,
        requestId: "request-rpc-error",
        toolName: "ega_list_tasks",
        outcome: "success",
        durationMs: 1,
      }),
    ).rejects.toThrow("Failed to persist EGA MCP audit event.");
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
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});
