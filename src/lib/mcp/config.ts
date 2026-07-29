import {
  normalizeMcpResourceUrl,
  normalizeSupabaseAuthorizationServer,
} from "@/lib/mcp/metadata";

export type McpRuntimeConfig = {
  enabled: boolean;
  writesEnabled: boolean;
  resource: string;
  issuer: string;
  supabaseUrl: string;
  publishableKey: string;
};

type McpEnvironment = Partial<
  Record<
    | "MCP_ENABLED"
    | "MCP_WRITES_ENABLED"
    | "MCP_RESOURCE_URL"
    | "NEXT_PUBLIC_SUPABASE_URL"
    | "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    string | undefined
  >
>;

function requireEnv(
  env: McpEnvironment,
  name:
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

export function getMcpRuntimeConfig(
  env: McpEnvironment = process.env,
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
  };
}
