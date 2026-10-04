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

    // An empty or over-long name is not a capability, so the capability lookup
    // rejects it first - before any window is consumed.
    await expect(consumeMcpRateLimit(client, "")).rejects.toThrow(
      "Unknown MCP capability",
    );
    await expect(consumeMcpRateLimit(client, "x".repeat(129))).rejects.toThrow(
      "Unknown MCP capability",
    );
    // An unknown tool name is a programming error, not a client input: the
    // capability lookup must fail rather than silently limit an unknown bucket.
    await expect(consumeMcpRateLimit(client, "ega_not_a_real_tool")).rejects.toThrow(
      "Unknown MCP capability",
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("adds no aggregate round trip when every aggregate bucket is disabled", async () => {
    const { client, rpc } = createClient({
      data: [{ allowed: true, retry_after_seconds: 0 }],
      error: null,
    });

    await expect(consumeMcpRateLimit(client, "ega_list_projects")).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("also consumes the risk-class aggregate bucket when one is configured", async () => {
    const { client, rpc } = createClient({
      data: [{ allowed: true, retry_after_seconds: 0 }],
      error: null,
    });

    await consumeMcpRateLimit(client, "ega_list_projects", {
      read: 600,
      write: 0,
      sensitive_write: 0,
    });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(2, "consume_mcp_rate_limit", {
      p_tool_name: "ega_aggregate_read",
      p_limit: 600,
      p_window_seconds: 60,
    });
  });

  it("refuses when the aggregate bucket is exhausted even though the tool window has room", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null })
      .mockResolvedValueOnce({ data: [{ allowed: false, retry_after_seconds: 41 }], error: null });
    const client = { rpc } as unknown as SupabaseClient<McpDatabase>;

    await expect(
      consumeMcpRateLimit(client, "ega_create_task", { read: 0, write: 5, sensitive_write: 0 }),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 41 });
    expect(rpc).toHaveBeenNthCalledWith(2, "consume_mcp_rate_limit", {
      p_tool_name: "ega_aggregate_write",
      p_limit: 5,
      p_window_seconds: 60,
    });
  });

  it("fails closed when a configured aggregate bucket cannot be evaluated", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null })
      .mockResolvedValueOnce({ error: { message: "aggregate window unavailable" } });
    const client = { rpc } as unknown as SupabaseClient<McpDatabase>;

    await expect(
      consumeMcpRateLimit(client, "ega_list_projects", { read: 600, write: 0, sensitive_write: 0 }),
    ).rejects.toThrow("Failed to enforce EGA MCP rate limit.");
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
