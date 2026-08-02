import type { SupabaseClient } from "@supabase/supabase-js";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";

export type McpRateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateToolName(toolName: string): void {
  if (!/^[a-z0-9_]{1,128}$/.test(toolName)) {
    throw new Error("Invalid EGA MCP rate-limit tool name.");
  }
}

export async function consumeMcpRateLimit(
  client: SupabaseClient<McpDatabase>,
  toolName: string,
): Promise<McpRateLimitResult> {
  validateToolName(toolName);

  const { data, error } = await client.rpc("consume_mcp_rate_limit", {
    p_tool_name: toolName,
    p_limit: 120,
    p_window_seconds: 60,
  });

  if (error) {
    throw new Error("Failed to enforce EGA MCP rate limit.");
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!isRecord(row)) {
    throw new Error("Invalid EGA MCP rate-limit response.");
  }

  const allowed = row.allowed;
  const retryAfterSeconds = row.retry_after_seconds;
  if (
    typeof allowed !== "boolean"
    || !Number.isInteger(retryAfterSeconds)
    || (retryAfterSeconds as number) < 0
  ) {
    throw new Error("Invalid EGA MCP rate-limit response.");
  }

  return {
    allowed,
    retryAfterSeconds: retryAfterSeconds as number,
  };
}
