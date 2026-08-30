import type { AuthInfo } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import type { McpAccessTokenVerifier } from "@/lib/mcp/authenticate-request";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import {
  resolveMcpPrincipal,
  type McpGrantRecord,
} from "@/lib/mcp/principal";
import { validateMcpAccessTokenClaims } from "@/lib/mcp/token-claims";

export type McpHandlerAuthDependencies = {
  issuer: string;
  audience: string;
  nowSeconds?: number;
  verifyAccessToken: McpAccessTokenVerifier;
  createUserClient: (accessToken: string) => SupabaseClient<McpDatabase>;
  loadGrant: (
    client: SupabaseClient<McpDatabase>,
    ownerUserId: string,
    oauthClientId: string,
    resourceUri: string,
  ) => Promise<McpGrantRecord | null>;
};

export async function verifyMcpHandlerToken(
  bearerToken: string | undefined,
  dependencies: McpHandlerAuthDependencies,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) {
    return undefined;
  }

  const untrustedClaims = await dependencies.verifyAccessToken(bearerToken);
  const identity = validateMcpAccessTokenClaims(untrustedClaims, {
    issuer: dependencies.issuer,
    audience: dependencies.audience,
    nowSeconds: dependencies.nowSeconds,
  });
  const client = dependencies.createUserClient(bearerToken);
  const grant = await dependencies.loadGrant(
    client,
    identity.sub,
    identity.client_id,
    dependencies.audience,
  );

  if (!grant) {
    return {
      token: bearerToken,
      clientId: identity.client_id,
      scopes: [],
      expiresAt: untrustedClaims.exp as number,
      extra: { ownerUserId: identity.sub },
    };
  }

  const principal = resolveMcpPrincipal(identity, grant);
  return createMcpAuthInfo(
    bearerToken,
    principal,
    untrustedClaims.exp as number,
  );
}
