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
    expect(rpc).toHaveBeenNthCalledWith(1, "consume_mcp_rate_limit", {
      p_window_name: "ega_list_projects",
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

  it("always consumes the risk-class aggregate bucket after the tool window", async () => {
    const { client, rpc } = createClient({
      data: [{ allowed: true, retry_after_seconds: 0 }],
      error: null,
    });

    await consumeMcpRateLimit(client, "ega_list_projects");

    expect(rpc).toHaveBeenCalledTimes(2);
    // The limit and window length are derived in the database. A client must not
    // be able to widen its own allowance by choosing them.
    expect(rpc).toHaveBeenNthCalledWith(2, "consume_mcp_rate_limit", {
      p_window_name: "ega_aggregate_read",
    });
  });

  it("buckets a write capability under the write aggregate, not the read one", async () => {
    const { client, rpc } = createClient({
      data: [{ allowed: true, retry_after_seconds: 0 }],
      error: null,
    });

    await consumeMcpRateLimit(client, "ega_create_task");

    expect(rpc).toHaveBeenNthCalledWith(2, "consume_mcp_rate_limit", {
      p_window_name: "ega_aggregate_write",
    });
  });

  it("refuses when the aggregate bucket is exhausted even though the tool window has room", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null })
      .mockResolvedValueOnce({ data: [{ allowed: false, retry_after_seconds: 41 }], error: null });
    const client = { rpc } as unknown as SupabaseClient<McpDatabase>;

    await expect(
      consumeMcpRateLimit(client, "ega_create_task"),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 41 });
    expect(rpc).toHaveBeenNthCalledWith(2, "consume_mcp_rate_limit", {
      p_window_name: "ega_aggregate_write",
    });
  });

  it("fails closed when the aggregate bucket cannot be evaluated", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null })
      .mockResolvedValueOnce({ error: { message: "aggregate window unavailable" } });
    const client = { rpc } as unknown as SupabaseClient<McpDatabase>;

    await expect(
      consumeMcpRateLimit(client, "ega_list_projects"),
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
