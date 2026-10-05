import type { AuthInfo } from "@modelcontextprotocol/server";

type RequestHandler = (request: Request) => Response | Promise<Response>;
type TokenVerifier = (
  request: Request,
  bearerToken?: string,
) => AuthInfo | undefined | Promise<AuthInfo | undefined>;

export type EgaMcpAuthOptions = {
  requiredScopes: string[];
  resourceMetadataPath: string;
  resourceUrl: string;
};

type AuthenticatedRequest = Request & { auth?: AuthInfo };

function isValidAuthInfo(value: unknown): value is AuthInfo {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const authInfo = value as Record<string, unknown>;
  return typeof authInfo.token === "string"
    && authInfo.token.length > 0
    && typeof authInfo.clientId === "string"
    && authInfo.clientId.length > 0
    && Array.isArray(authInfo.scopes)
    && authInfo.scopes.every((scope) => typeof scope === "string" && scope.length > 0)
    && (authInfo.expiresAt === undefined || (typeof authInfo.expiresAt === "number" && Number.isFinite(authInfo.expiresAt)));
}

function challenge(
  options: EgaMcpAuthOptions,
  error: "invalid_token" | "insufficient_scope",
  description: string,
): string {
  const resourceMetadata = `${options.resourceUrl}${options.resourceMetadataPath}`;
  return `Bearer error="${error}", error_description="${description}", resource_metadata="${resourceMetadata}"`;
}

function oauthError(
  status: 401 | 403,
  options: EgaMcpAuthOptions,
  error: "invalid_token" | "insufficient_scope",
  description: string,
): Response {
  return Response.json(
    { error, error_description: description },
    {
      status,
      headers: {
        "WWW-Authenticate": challenge(options, error, description),
        // Every response on this route is no-store and origin-dependent. This one
        // is produced BEFORE Host/Origin is validated, so it must not echo an
        // allow-origin: doing so would advertise the authenticated path to any
        // origin, which is exactly the wildcard failure in a narrower shape.
        // `Vary: Origin` is still correct - it tells a cache this refusal is
        // decided per origin, and no-store is what stops it being stored.
        "Cache-Control": "no-store",
        Vary: "Origin",
      },
    },
  );
}

function extractBearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (!authorization) return undefined;
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  return match?.[1];
}

/**
 * The one place the verified identity is read off a request.
 *
 * `withEgaMcpAuth` writes it and every consumer should read it here. The
 * transport used to reach for `(request as Request & { auth?: AuthInfo }).auth`
 * itself, which left this exported accessor looking canonical while the
 * production path quietly bypassed it - two readers of one piece of state, one
 * of them a cast.
 */
export function getMcpRequestAuthInfo(request: Request): AuthInfo | undefined {
  return (request as AuthenticatedRequest).auth;
}

export function withEgaMcpAuth(
  handler: RequestHandler,
  verifyToken: TokenVerifier,
  options: EgaMcpAuthOptions,
): RequestHandler {
  return async (request: Request): Promise<Response> => {
    const bearerToken = extractBearerToken(request);
    if (!bearerToken) {
      // No `required: false` escape. It existed as an option, every caller in
      // the repo passed `true`, and its only effect was to reach this line and
      // forward an unauthenticated request - a fail-open path kept alive by a
      // flag no one set. Removing it deletes the path rather than documenting
      // it.
      return oauthError(
        401,
        options,
        "invalid_token",
        "Bearer authorization is required.",
      );
    }

    let authInfo: AuthInfo | undefined;
    try {
      authInfo = await verifyToken(request, bearerToken);
    } catch {
      return oauthError(
        401,
        options,
        "invalid_token",
        "Invalid access token.",
      );
    }

    if (!isValidAuthInfo(authInfo)) {
      return oauthError(
        401,
        options,
        "invalid_token",
        "Invalid access token.",
      );
    }

    if (
      authInfo.expiresAt !== undefined
      && authInfo.expiresAt < Date.now() / 1000
    ) {
      return oauthError(
        401,
        options,
        "invalid_token",
        "Access token has expired.",
      );
    }

    const hasRequiredScopes = options.requiredScopes.every((scope) =>
      authInfo.scopes.includes(scope),
    );
    if (!hasRequiredScopes) {
      return oauthError(
        403,
        options,
        "insufficient_scope",
        "No active EGA MCP authorization grant.",
      );
    }

    Object.defineProperty(request, "auth", {
      value: authInfo,
      enumerable: false,
      configurable: false,
      writable: false,
    });

    return await handler(request);
  };
}
