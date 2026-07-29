import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

import type { McpRuntimeConfig } from "@/lib/mcp/config";
import { loadActiveMcpGrant } from "@/lib/mcp/grant-repository";
import {
  verifyMcpHandlerToken,
  type McpHandlerAuthDependencies,
} from "@/lib/mcp/handler-auth";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import {
  createSupabaseAccessTokenVerifier,
  type SupabaseClaimsClient,
} from "@/lib/mcp/supabase-token-verifier";
import {
  createMcpSupabaseClient,
  type McpSupabaseClientFactory,
} from "@/lib/mcp/supabase-user-client";

function createVerifierClient(
  supabaseUrl: string,
  publishableKey: string,
): SupabaseClient<McpDatabase> {
  return createClient<McpDatabase>(supabaseUrl, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export type McpRuntimeAuthDependencies = {
  createVerifierClient: (
    supabaseUrl: string,
    publishableKey: string,
  ) => SupabaseClient<McpDatabase>;
  createAccessTokenVerifier: typeof createSupabaseAccessTokenVerifier;
  createUserClient: (
    accessToken: string,
    options: {
      supabaseUrl: string;
      publishableKey: string;
      factory?: McpSupabaseClientFactory;
    },
  ) => SupabaseClient<McpDatabase>;
  loadGrant: typeof loadActiveMcpGrant;
  verifyHandlerToken: typeof verifyMcpHandlerToken;
};

const DEFAULT_DEPENDENCIES: McpRuntimeAuthDependencies = {
  createVerifierClient,
  createAccessTokenVerifier: createSupabaseAccessTokenVerifier,
  createUserClient: createMcpSupabaseClient,
  loadGrant: loadActiveMcpGrant,
  verifyHandlerToken: verifyMcpHandlerToken,
};

export function createMcpHandlerTokenVerifier(
  config: McpRuntimeConfig,
  dependencies: McpRuntimeAuthDependencies = DEFAULT_DEPENDENCIES,
): (req: Request, bearerToken?: string) => Promise<AuthInfo | undefined> {
  const verifierClient = dependencies.createVerifierClient(
    config.supabaseUrl,
    config.publishableKey,
  );
  const verifyAccessToken = dependencies.createAccessTokenVerifier(
    verifierClient as unknown as SupabaseClaimsClient,
  );

  return async (_req: Request, bearerToken?: string) => {
    return dependencies.verifyHandlerToken(bearerToken, {
      issuer: config.issuer,
      audience: config.resource,
      verifyAccessToken,
      createUserClient: (accessToken) =>
        dependencies.createUserClient(accessToken, {
          supabaseUrl: config.supabaseUrl,
          publishableKey: config.publishableKey,
        }),
      loadGrant: dependencies.loadGrant,
    } satisfies McpHandlerAuthDependencies);
  };
}
