import { McpAuthorizationError } from "@/lib/mcp/principal";
import {
  validateMcpAccessTokenClaims,
  type McpAccessTokenClaims,
  type ValidatedMcpIdentityClaims,
} from "@/lib/mcp/token-claims";

export type McpAccessTokenVerifier = (
  accessToken: string,
) => Promise<McpAccessTokenClaims>;

type AuthenticateMcpRequestOptions = {
  issuer: string;
  audience: string;
  nowSeconds?: number;
  verifyAccessToken: McpAccessTokenVerifier;
};

export type AuthenticatedMcpRequest = {
  accessToken: string;
  claims: ValidatedMcpIdentityClaims;
};

function unauthenticated(message: string): never {
  throw new McpAuthorizationError("UNAUTHENTICATED", 401, message);
}

export function extractBearerToken(headers: Headers): string {
  const authorization = headers.get("authorization");

  if (!authorization) {
    return unauthenticated("Missing Bearer access token.");
  }

  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  if (!match?.[1]) {
    return unauthenticated("Invalid Bearer access token.");
  }

  return match[1];
}

export async function authenticateMcpRequest(
  headers: Headers,
  options: AuthenticateMcpRequestOptions,
): Promise<AuthenticatedMcpRequest> {
  const accessToken = extractBearerToken(headers);

  let untrustedClaims: McpAccessTokenClaims;
  try {
    untrustedClaims = await options.verifyAccessToken(accessToken);
  } catch {
    return unauthenticated("Access token verification failed.");
  }

  const claims = validateMcpAccessTokenClaims(untrustedClaims, {
    issuer: options.issuer,
    audience: options.audience,
    nowSeconds: options.nowSeconds,
  });

  return { accessToken, claims };
}
