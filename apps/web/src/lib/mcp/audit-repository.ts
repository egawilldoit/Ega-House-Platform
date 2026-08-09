import type { SupabaseClient } from "@supabase/supabase-js";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import type { McpPrincipal } from "@/lib/mcp/principal";
import type { Json } from "@/lib/supabase/database.types";

export type McpAuditOutcome = "success" | "error" | "denied";

export type McpAuditEventInput = {
  principal: McpPrincipal;
  requestId: string;
  toolName: string;
  outcome: McpAuditOutcome;
  durationMs: number;
  errorCode?: string;
  metadata?: Record<string, Json>;
};

function requireBoundedValue(
  value: string,
  label: string,
  maxLength: number,
): string {
  if (value.trim() === "" || value.length > maxLength) {
    throw new Error(`${label} must be between 1 and ${maxLength} characters.`);
  }
  return value;
}

export async function writeMcpAuditEvent(
  client: SupabaseClient<McpDatabase>,
  input: McpAuditEventInput,
): Promise<void> {
  if (
    !Number.isInteger(input.durationMs)
    || input.durationMs < 0
  ) {
    throw new Error("MCP audit duration must be a non-negative integer.");
  }

  const requestId = requireBoundedValue(input.requestId, "MCP request ID", 64);
  const toolName = requireBoundedValue(input.toolName, "MCP tool name", 128);
  const errorCode = input.errorCode
    ? requireBoundedValue(input.errorCode, "MCP error code", 64)
    : null;

  const { error } = await client
    .from("agent_integration_events")
    .insert({
      owner_user_id: input.principal.ownerUserId,
      token_id: null,
      oauth_client_id: input.principal.oauthClientId,
      grant_id: input.principal.grantId,
      action: "mcp_tool_call",
      resource_type: "mcp_tool",
      resource_id: null,
      outcome: input.outcome,
      ip_address: null,
      request_id: requestId,
      tool_name: toolName,
      metadata: input.metadata ?? {},
      duration_ms: input.durationMs,
      error_code: errorCode,
    });

  if (error) {
    throw new Error("Failed to persist EGA MCP audit event.");
  }
}
