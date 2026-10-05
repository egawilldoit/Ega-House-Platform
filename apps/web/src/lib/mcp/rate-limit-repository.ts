import type { SupabaseClient } from "@supabase/supabase-js";

import { getCapability, type McpRateClass } from "@/lib/mcp/capability-registry";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";

export type McpRateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

/**
 * Aggregate buckets share the existing distributed counter, keyed on
 * (owner, client, window name) and re-checking the active grant on every call.
 *
 * The `ega_aggregate_` prefix keeps buckets in a namespace no capability can
 * occupy: every registered tool is `ega_<verb>_<noun>` and the registry test
 * asserts no tool name starts with this prefix, so an aggregate window can
 * never be confused with a tool's own window.
 */
export const MCP_AGGREGATE_BUCKET_PREFIX = "ega_aggregate_";

export function aggregateBucketName(rateClass: McpRateClass): string {
  return `${MCP_AGGREGATE_BUCKET_PREFIX}${rateClass}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * The RPC takes a window NAME only. The limit and the window length are derived
 * server-side (drizzle/0071).
 *
 * Both were caller arguments until an independent security review measured the
 * bypass: the conflict handler treats a window mismatch as a fresh bucket, so
 * one extra RPC call with a shorter window reset the counter and restored the
 * full allowance, and `p_limit` could be passed as 10000 to disable the limit
 * outright. An MCP bearer holds the credential the limiter protects, so the
 * limiter's parameters are policy, not input.
 */
async function consumeWindow(
  client: SupabaseClient<McpDatabase>,
  windowName: string,
): Promise<McpRateLimitResult> {
  const { data, error } = await client.rpc("consume_mcp_rate_limit", {
    p_window_name: windowName,
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

  return { allowed, retryAfterSeconds: retryAfterSeconds as number };
}

/**
 * Per-tool protection plus an aggregate bound per capability risk class.
 *
 * The aggregate bucket is what stops total throughput from multiplying as the
 * tool count grows: a client can no longer spend 30 tools' worth of allowance in
 * the same minute. Thresholds live in the database because they are policy and
 * a client must not be able to influence them.
 *
 * Fail-closed: if a bucket cannot be evaluated the call is refused rather than
 * proceeding, so a limiter outage cannot become an unbounded-throughput outage.
 */
export async function consumeMcpRateLimit(
  client: SupabaseClient<McpDatabase>,
  toolName: string,
): Promise<McpRateLimitResult> {
  // Resolve the capability BEFORE consuming any window: an unregistered tool
  // name is a programming error, and it must not burn a caller's quota or fail
  // with a confusing rate-limit error before the real cause surfaces.
  const rateClass = getCapability(toolName).rateClass;

  const perTool = await consumeWindow(client, toolName);
  if (!perTool.allowed) {
    return perTool;
  }

  const aggregate = await consumeWindow(client, aggregateBucketName(rateClass));
  if (!aggregate.allowed) {
    // Report the larger wait so a client genuinely done retrying the other
    // bucket is not sent back early.
    return {
      allowed: false,
      retryAfterSeconds: Math.max(perTool.retryAfterSeconds, aggregate.retryAfterSeconds),
    };
  }

  return perTool;
}
