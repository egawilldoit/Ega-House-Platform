import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

type RequestHandler = (request: Request) => Response | Promise<Response>;
type TokenVerifier = (
  request: Request,
  bearerToken?: string,
) => AuthInfo | undefined | Promise<AuthInfo | undefined>;

export type EgaMcpAuthOptions = {
  required: boolean;
  requiredScopes: string[];
  resourceMetadataPath: string;
  resourceUrl: string;
};

type AuthenticatedRequest = Request & { auth?: AuthInfo };

function challenge(
  options: EgaMcpAuthOptions,
  error: "invalid_token" | "insufficient_scope",
  description: string,
): string {
  const resourceMetadata = `${options.resourceUrl}${options.resourceMetadataPath}`;
  return [
    "Bearer",
    `error="${error}"`,
    `error_description="${description}"`,
    `resource_metadata="${resourceMetadata}"`,
  ].join(", ");
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
        "Cache-Control": "no-store",
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
      if (!options.required) return await handler(request);
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

    if (!authInfo) {
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
      authInfo?.scopes.includes(scope),
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
