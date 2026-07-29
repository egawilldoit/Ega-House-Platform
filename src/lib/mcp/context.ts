import type { SupabaseClient } from "@supabase/supabase-js";

import {
  authenticateMcpRequest,
  type McpAccessTokenVerifier,
} from "@/lib/mcp/authenticate-request";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import {
  resolveMcpPrincipal,
  type McpGrantRecord,
  type McpPrincipal,
} from "@/lib/mcp/principal";

type CreateUserClient = (
  accessToken: string,
) => SupabaseClient<McpDatabase>;

type LoadGrant = (
  client: SupabaseClient<McpDatabase>,
  ownerUserId: string,
  oauthClientId: string,
) => Promise<McpGrantRecord | null>;

type CreateAuthenticatedMcpContextOptions = {
  issuer: string;
  audience: string;
  nowSeconds?: number;
  verifyAccessToken: McpAccessTokenVerifier;
  createUserClient: CreateUserClient;
  loadGrant: LoadGrant;
};

export type AuthenticatedMcpContext = {
  client: SupabaseClient<McpDatabase>;
  principal: McpPrincipal;
};

export async function createAuthenticatedMcpContext(
  headers: Headers,
  options: CreateAuthenticatedMcpContextOptions,
): Promise<AuthenticatedMcpContext> {
  const authenticatedRequest = await authenticateMcpRequest(headers, {
    issuer: options.issuer,
    audience: options.audience,
    nowSeconds: options.nowSeconds,
    verifyAccessToken: options.verifyAccessToken,
  });

  const client = options.createUserClient(authenticatedRequest.accessToken);
  const grant = await options.loadGrant(
    client,
    authenticatedRequest.claims.sub,
    authenticatedRequest.claims.client_id,
  );
  const principal = resolveMcpPrincipal(
    authenticatedRequest.claims,
    grant,
  );

  return { client, principal };
}
