import { McpAuthorizationError } from "@/lib/mcp/principal";

export type McpAccessTokenClaims = {
  iss?: unknown;
  aud?: unknown;
  sub?: unknown;
  client_id?: unknown;
  exp?: unknown;
  nbf?: unknown;
  [claim: string]: unknown;
};

type McpAccessTokenValidationOptions = {
  issuer: string;
  audience: string;
  nowSeconds?: number;
};

export type ValidatedMcpIdentityClaims = {
  sub: string;
  client_id: string;
};

function rejectToken(message: string): never {
  throw new McpAuthorizationError("UNAUTHENTICATED", 401, message);
}

function hasExpectedAudience(aud: unknown, expected: string): boolean {
  if (typeof aud === "string") {
    return aud === expected;
  }

  if (Array.isArray(aud)) {
    return aud.some((value) => value === expected);
  }

  return false;
}

export function validateMcpAccessTokenClaims(
  claims: McpAccessTokenClaims,
  options: McpAccessTokenValidationOptions,
): ValidatedMcpIdentityClaims {
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (claims.iss !== options.issuer) {
    return rejectToken("Invalid access token issuer.");
  }

  if (!hasExpectedAudience(claims.aud, options.audience)) {
    return rejectToken("Invalid access token audience.");
  }

  if (
    typeof claims.exp !== "number"
    || !Number.isFinite(claims.exp)
    || claims.exp <= nowSeconds
  ) {
    return rejectToken("Access token is expired or missing expiration.");
  }

  if (
    claims.nbf !== undefined
    && (
      typeof claims.nbf !== "number"
      || !Number.isFinite(claims.nbf)
      || claims.nbf > nowSeconds
    )
  ) {
    return rejectToken("Access token is not active.");
  }

  if (typeof claims.sub !== "string" || claims.sub.trim() === "") {
    return rejectToken("Missing or invalid sub claim.");
  }

  if (
    typeof claims.client_id !== "string"
    || claims.client_id.trim() === ""
  ) {
    return rejectToken("Missing or invalid client_id claim.");
  }

  return {
    sub: claims.sub,
    client_id: claims.client_id,
  };
}
