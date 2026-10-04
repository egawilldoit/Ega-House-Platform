import {
  normalizeMcpResourceUrl,
  normalizeSupabaseAuthorizationServer,
} from "@/lib/mcp/metadata";

import type { McpAggregateRateLimits } from "@/lib/mcp/rate-limit-repository";

export type McpRuntimeConfig = {
  enabled: boolean;
  writesEnabled: boolean;
  resource: string;
  issuer: string;
  supabaseUrl: string;
  publishableKey: string;
  /**
   * Opt-in aggregate per-minute allowances, one per capability risk class. A
   * value of 0 disables that bucket. They are configuration rather than
   * constants because a threshold is an operational quota: this repository has
   * no product authority for a number, so shipping one as a default would be
   * inventing policy. The mechanism, its distribution and its grant binding are
   * proven; the numbers are a product decision.
   */
  aggregateRateLimits: McpAggregateRateLimits;
};

type McpEnvironment = Partial<
  Record<
    | "MCP_ENABLED"
    | "MCP_WRITES_ENABLED"
    | "MCP_RATE_LIMIT_AGGREGATE_READ_PER_MINUTE"
    | "MCP_RATE_LIMIT_AGGREGATE_WRITE_PER_MINUTE"
    | "MCP_RATE_LIMIT_AGGREGATE_SENSITIVE_WRITE_PER_MINUTE"
    | "MCP_RESOURCE_URL"
    | "NEXT_PUBLIC_SUPABASE_URL"
    | "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    string | undefined
  >
>;

function requireEnv(
  env: McpEnvironment,
  name:
    | "MCP_RATE_LIMIT_AGGREGATE_READ_PER_MINUTE"
    | "MCP_RATE_LIMIT_AGGREGATE_WRITE_PER_MINUTE"
    | "MCP_RATE_LIMIT_AGGREGATE_SENSITIVE_WRITE_PER_MINUTE"
    | "MCP_RESOURCE_URL"
    | "NEXT_PUBLIC_SUPABASE_URL"
    | "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
): string {
  const value = env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing env.${name}`);
  }
  return value;
}

function isExplicitlyEnabled(value: string | undefined): boolean {
  return value === "true";
}

/** Parses an opt-in aggregate allowance. Anything unparseable means disabled. */
function parseAggregateLimit(value: string | undefined): number {
  if (!value || value.trim() === "") return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10000) return 0;
  return parsed;
}

export function getMcpRuntimeConfig(
  env: McpEnvironment = process.env as McpEnvironment,
): McpRuntimeConfig {
  const enabled = isExplicitlyEnabled(env.MCP_ENABLED);
  const supabaseUrl = requireEnv(env, "NEXT_PUBLIC_SUPABASE_URL");

  return {
    enabled,
    writesEnabled:
      enabled && isExplicitlyEnabled(env.MCP_WRITES_ENABLED),
    resource: normalizeMcpResourceUrl(
      requireEnv(env, "MCP_RESOURCE_URL"),
    ),
    issuer: normalizeSupabaseAuthorizationServer(supabaseUrl),
    supabaseUrl,
    publishableKey: requireEnv(
      env,
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ),
    aggregateRateLimits: {
      read: parseAggregateLimit(env.MCP_RATE_LIMIT_AGGREGATE_READ_PER_MINUTE),
      write: parseAggregateLimit(env.MCP_RATE_LIMIT_AGGREGATE_WRITE_PER_MINUTE),
      sensitive_write: parseAggregateLimit(
        env.MCP_RATE_LIMIT_AGGREGATE_SENSITIVE_WRITE_PER_MINUTE,
      ),
    },
  };
}
