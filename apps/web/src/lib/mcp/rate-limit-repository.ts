import type { SupabaseClient } from "@supabase/supabase-js";

import { getCapability, type McpRateClass } from "@/lib/mcp/capability-registry";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";

export type McpRateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export type McpAggregateRateLimits = Readonly<Record<McpRateClass, number>>;

/**
 * Per-tool allowance, unchanged from before this module grew an aggregate
 * bucket. This is deliberately NOT differentiated by risk class: the documented
 * "writes 30/min" in ARCHITECTURE.md was never implemented, and tightening an
 * existing client's allowance is a product decision, not an implementation
 * choice. Correcting the doc is the right move here; silently enforcing a
 * stricter write limit would have broken live clients.
 */
const PER_TOOL_LIMIT = 120;
const PER_TOOL_WINDOW_SECONDS = 60;

/**
 * Aggregate buckets share the existing distributed counter, which is keyed on
 * (owner, client, window name) and re-checks the active grant on every call.
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

function validateWindowName(name: string): void {
  if (!/^[a-z0-9_]{1,128}$/.test(name)) {
    throw new Error("Invalid EGA MCP rate-limit window name.");
  }
}

async function consumeWindow(
  client: SupabaseClient<McpDatabase>,
  windowName: string,
  limit: number,
): Promise<McpRateLimitResult> {
  validateWindowName(windowName);

  const { data, error } = await client.rpc("consume_mcp_rate_limit", {
    p_tool_name: windowName,
    p_limit: limit,
    p_window_seconds: PER_TOOL_WINDOW_SECONDS,
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

/**
 * Per-tool protection plus an optional aggregate bound per risk class.
 *
 * The aggregate bucket is what stops total throughput from multiplying as the
 * tool count grows: a client can no longer spend 30 tools' worth of allowance
 * in the same minute. It is opt-in per class because a threshold is an
 * operational quota, and this repository has no product authority for one. A
 * class configured to 0 is disabled and costs no database round trip.
 *
 * Fail-closed: if a configured bucket cannot be evaluated, the call is refused
 * rather than silently proceeding. An aggregate outage must not become an
 * unbounded-throughput outage.
 */
export async function consumeMcpRateLimit(
  client: SupabaseClient<McpDatabase>,
  toolName: string,
  aggregateLimits: McpAggregateRateLimits = DEFAULT_AGGREGATE_LIMITS,
): Promise<McpRateLimitResult> {
  // Resolve the capability BEFORE consuming any window: an unregistered tool
  // name is a programming error, and it must not burn a caller's quota or fail
  // with a confusing rate-limit error before the real cause surfaces.
  const rateClass = getCapability(toolName).rateClass;

  const perTool = await consumeWindow(client, toolName, PER_TOOL_LIMIT);
  if (!perTool.allowed) {
    return perTool;
  }

  const aggregateLimit = aggregateLimits[rateClass];
  if (!aggregateLimit || aggregateLimit <= 0) {
    return perTool;
  }

  const aggregate = await consumeWindow(
    client,
    aggregateBucketName(rateClass),
    aggregateLimit,
  );
  if (!aggregate.allowed) {
    return {
      allowed: false,
      // Report the larger of the two waits so a client that is genuinely done
      // retrying the other bucket is not sent back early.
      retryAfterSeconds: Math.max(perTool.retryAfterSeconds, aggregate.retryAfterSeconds),
    };
  }

  return perTool;
}

export const DEFAULT_AGGREGATE_LIMITS: McpAggregateRateLimits = {
  read: 0,
  write: 0,
  sensitive_write: 0,
};
