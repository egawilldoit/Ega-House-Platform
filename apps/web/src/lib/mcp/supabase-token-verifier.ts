import type { McpAccessTokenClaims } from "@/lib/mcp/token-claims";

export type SupabaseClaimsClient = {
  auth: {
    getClaims: (accessToken: string) => Promise<{
      data: { claims?: unknown } | null;
      error: unknown;
    }>;
  };
};

function isClaimsObject(value: unknown): value is McpAccessTokenClaims {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createSupabaseAccessTokenVerifier(
  client: SupabaseClaimsClient,
): (accessToken: string) => Promise<McpAccessTokenClaims> {
  return async (accessToken: string) => {
    const { data, error } = await client.auth.getClaims(accessToken);

    if (error || !isClaimsObject(data?.claims)) {
      throw new Error("Supabase access token verification failed.");
    }

    return data.claims;
  };
}
