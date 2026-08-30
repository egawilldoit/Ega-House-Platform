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

  const { error } = await client.rpc("record_mcp_audit_event", {
    p_request_id: requestId,
    p_tool_name: toolName,
    p_outcome: input.outcome,
    p_duration_ms: input.durationMs,
    p_error_code: errorCode,
    p_metadata: input.metadata ?? {},
  });

  if (error) {
    throw new Error("Failed to persist EGA MCP audit event.");
  }
}
