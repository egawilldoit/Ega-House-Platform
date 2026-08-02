import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { consumeMcpRateLimit } from "@/lib/mcp/rate-limit-repository";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";

function createClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return {
    client: { rpc } as unknown as SupabaseClient<McpDatabase>,
    rpc,
  };
}

describe("consumeMcpRateLimit", () => {
  it("consumes a bounded database-backed read allowance", async () => {
    const { client, rpc } = createClient({
      data: [{ allowed: true, retry_after_seconds: 0 }],
      error: null,
    });

    await expect(
      consumeMcpRateLimit(client, "ega_list_projects"),
    ).resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(rpc).toHaveBeenCalledWith("consume_mcp_rate_limit", {
      p_tool_name: "ega_list_projects",
      p_limit: 120,
      p_window_seconds: 60,
    });
  });

  it("returns retry timing when the database limit is exceeded", async () => {
    const { client } = createClient({
      data: [{ allowed: false, retry_after_seconds: 17 }],
      error: null,
    });

    await expect(
      consumeMcpRateLimit(client, "ega_list_tasks"),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 17 });
  });

  it("rejects unbounded or malformed tool names before SQL", async () => {
    const { client, rpc } = createClient({ data: [], error: null });

    await expect(consumeMcpRateLimit(client, "")).rejects.toThrow(
      "Invalid EGA MCP rate-limit tool name.",
    );
    await expect(
      consumeMcpRateLimit(client, "x".repeat(129)),
    ).rejects.toThrow("Invalid EGA MCP rate-limit tool name.");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("redacts database and malformed response details", async () => {
    const failed = createClient({
      data: null,
      error: { message: "sensitive database detail" },
    });
    const malformed = createClient({
      data: [{ allowed: "yes", retry_after_seconds: -1 }],
      error: null,
    });

    await expect(
      consumeMcpRateLimit(failed.client, "ega_list_goals"),
    ).rejects.toThrow("Failed to enforce EGA MCP rate limit.");
    await expect(
      consumeMcpRateLimit(malformed.client, "ega_list_goals"),
    ).rejects.toThrow("Invalid EGA MCP rate-limit response.");
  });
});
