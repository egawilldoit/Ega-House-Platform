import type { McpServer } from "@modelcontextprotocol/server";
import { McpServer as RuntimeMcpServer, createMcpHandler } from "@modelcontextprotocol/server";
import type { AuthInfo } from "@modelcontextprotocol/server";

import { getMcpRequestAuthInfo } from "@/lib/mcp/http-auth";


type RequestHandler = (request: Request) => Response | Promise<Response>;

/**
 * The only transport option, because it is the only one anything reads.
 *
 * `basePath`, `maxDuration` and `verboseLogs` used to sit here and were read by
 * nothing in this module: it never routes on a path (Next.js routes the URL), it
 * never sets a timeout (the request budget is a platform concern owned by
 * `apps/web/src/app/api/mcp/route.ts`, whose `export const maxDuration` is what
 * Next.js actually reads), and it never logs. Carrying three fields that had no
 * effect made the transport look configurable along axes nothing consulted, and
 * `route-runtime` had to keep hardcoding values for them.
 */
type TransportOptions = {
  resourceUrl: string;
};

const MCP_PROTOCOL_VERSION = "2026-07-28";
const MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024;

/**
 * The route accepts POST and answers preflight; GET is 405 because this
 * deployment is stateless with no server-initiated stream. Shared by
 * `Access-Control-Allow-Methods` and the 405's `Allow`, which are different
 * directives that must name the same set - the allowed methods are one fact
 * about the route, not one fact per header.
 */
const MCP_ALLOWED_METHODS = "POST, OPTIONS";
const MCP_PREFLIGHT_REQUEST_HEADERS =
  "Authorization, Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name";
const MCP_PREFLIGHT_MAX_AGE_SECONDS = "86400";

export type McpOriginPolicy = {
  expectedHost: string;
  expectedOrigin: string;
};

/**
 * The single derivation of the Host/Origin policy from the configured resource
 * URL.
 *
 * `createWebMcpHandler` and the route's preflight both call this with the same
 * `config.resource`. They used to each parse the URL themselves, so nothing
 * structurally tied the preflight's expected host/origin to the authenticated
 * path's: two independent derivations that agreed only because two literals
 * happened to match. One function makes the agreement a property of the code
 * rather than of the reader's memory.
 */
export function mcpOriginPolicy(resourceUrl: string): McpOriginPolicy {
  const url = new URL(resourceUrl);
  return { expectedHost: url.host, expectedOrigin: url.origin };
}

/**
 * The single preflight implementation. Host and Origin are validated with
 * exactly the functions the authenticated path uses, so OPTIONS cannot be a
 * less-guarded entry point than POST.
 *
 * When the browser's Origin matches the resource origin it is echoed back with
 * `Vary: Origin`; a wildcard is never returned, because a wildcard would again
 * promise access the authenticated path then refuses. A mismatched Origin is
 * refused outright and no allow-origin header is emitted, which is what makes
 * the browser block it.
 */
export function createMcpPreflightResponse(
  request: Request,
  policy: McpOriginPolicy,
): Response {
  const hostError = validateMcpHost(request, policy.expectedHost);
  if (hostError) return hostError;

  const originError = validateMcpOrigin(request, policy.expectedOrigin);
  if (originError) return originError;

  const origin = request.headers.get("origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": MCP_ALLOWED_METHODS,
    "Access-Control-Allow-Headers": MCP_PREFLIGHT_REQUEST_HEADERS,
    "Access-Control-Max-Age": MCP_PREFLIGHT_MAX_AGE_SECONDS,
    // 204 is heuristically cacheable, this body is origin-dependent, and the
    // Max-Age is 24h. Every sibling response on this route is no-store; this one
    // was not, so correctness rested entirely on Vary surviving.
    "Cache-Control": "no-store",
    Vary: "Origin",
  };

  // No Origin means a non-browser caller; there is nothing for CORS to gate.
  if (origin) {
    headers["Access-Control-Allow-Origin"] = new URL(origin).origin;
  }

  return new Response(null, { status: 204, headers });
}

/**
 * Merge into `Vary` rather than replace it. The streamable-HTTP response is
 * negotiated on `Accept`, and a `Vary` already contributed by the SDK or by a
 * future dependency must survive ours: replacing it would tell a shared cache
 * that the response depends on `Origin` alone, which is the exact
 * "cached incorrectly" failure the header exists to prevent. `Vary: *` already
 * forbids reuse, so it is left alone.
 */
function varyByOrigin(headers: Headers): void {
  const current = headers.get("Vary");
  if (current === "*") return;
  const fields = current
    ? current.split(",").map((field) => field.trim().toLowerCase())
    : [];
  if (fields.includes("origin")) return;
  headers.set("Vary", current ? `${current}, Origin` : "Origin");
}

/**
 * Idempotent `no-store`. The SDK already sends `Cache-Control: no-cache,
 * no-transform` on its own responses, so a blind `append` would produce
 * `no-cache, no-transform, no-store` on one call and a duplicate directive on the
 * next. `no-store` subsumes `no-cache`, so it is added once and never doubled.
 */
function forbidCaching(headers: Headers): void {
  const current = headers.get("Cache-Control");
  if (!current) {
    headers.set("Cache-Control", "no-store");
    return;
  }
  const directives = current.split(",").map((directive) => directive.trim().toLowerCase());
  if (directives.includes("no-store")) return;
  headers.set("Cache-Control", `${current}, no-store`);
}

/**
 * The origin contract, applied to every response produced once `Host` and
 * `Origin` have been accepted: the caller's Origin echoed exactly, `Vary:
 * Origin`, and no-store.
 *
 * Preflight and POST share one verdict, but until this the contract differed:
 * preflight returned `Access-Control-Allow-Origin` and the authenticated POST
 * returned none, so a cross-origin browser client that preflighted successfully
 * had its response discarded for lack of the header. Echoing the same value
 * here is what makes it one contract rather than one verdict.
 *
 * Only ever the exact resource origin - `validateMcpOrigin` has already refused
 * anything else - so this cannot widen the policy. `Access-Control-Allow-
 * Credentials` is deliberately never emitted: auth is a Bearer header, not a
 * cookie, and credentialed CORS is what would make a wildcard dangerous.
 */
export function applyMcpCorsHeaders(
  request: Request,
  headers: Headers,
  expectedOrigin: string,
): Headers {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin === expectedOrigin) {
        headers.set("Access-Control-Allow-Origin", expectedOrigin);
      }
    } catch {
      // validateMcpOrigin already rejected an unparseable Origin; nothing to do.
    }
  }
  varyByOrigin(headers);
  forbidCaching(headers);
  return headers;
}

function invalidRequest(description: string, status: 400 | 403 | 413 | 421 = 400): Response {
  return Response.json(
    { error: "invalid_request", error_description: description },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Strip one explicit default port so an authority that round-trips can be
 * recognised. `ega.example.com:443` and `ega.example.com` are the same endpoint,
 * so only `:443` is forgiven; `:80` is not, because this resource is HTTPS.
 */
function withoutExplicitHttpsPort(host: string): string {
  return host.toLowerCase().replace(/^([a-z0-9.\-[\]:]+):443$/, "$1");
}

export function validateMcpHost(request: Request, expectedHost: string): Response | null {
  const hostHeader = request.headers.get("host");
  if (!hostHeader) return invalidRequest("Missing Host header.");
  if (hostHeader.includes(",") || /[\s/#?@]/.test(hostHeader)) {
    return invalidRequest("Invalid Host header.");
  }

  let parsed: URL;
  try {
    // https, not http: `new URL('http://host:80').host` strips the default 80 and
    // normalises onto the resource host, so an explicit port 80 was accepted
    // against an https-only resource.
    parsed = new URL(`https://${hostHeader}`);
  } catch {
    return invalidRequest("Invalid Host header.");
  }

  // The authority we compare against must be the authority we were given, up to
  // case and an explicit default port. WHATWG URL is more forgiving than the
  // intermediaries in front of this route: it treats `\` as a path separator, so
  // `ega.example.com\evil.com` parses to the host `ega.example.com` and was
  // ACCEPTED; it percent-decodes hostnames, so `%65ga.example.com` parsed to
  // `ega.example.com` and was ACCEPTED too. In both cases this code concluded
  // "this is our resource" about an authority an intermediary may read as
  // something else entirely, which is a Host check decided by a parser
  // difference rather than by the value. Requiring the parse to round-trip
  // closes the whole class instead of enumerating characters.
  if (parsed.host.toLowerCase() !== withoutExplicitHttpsPort(hostHeader)) {
    return invalidRequest("Invalid Host header.");
  }

  if (parsed.host !== expectedHost) return invalidRequest("Invalid Host header.", 421);
  return null;
}

/**
 * ONE origin policy, shared by preflight and by the actual request.
 *
 * The authenticated browser surface is exactly the MCP resource origin: an
 * exact match, never a wildcard. Preflight previously advertised
 * `Access-Control-Allow-Origin: *` while POST rejected every origin but one, so
 * a browser on any other origin was told it was allowed and then refused.
 *
 * A missing Origin is allowed, because a server-to-server client legitimately
 * omits it; Host validation still applies, and auth is a Bearer header a
 * browser cannot attach cross-origin without CORS approval.
 */
export function validateMcpOrigin(request: Request, expectedOrigin: string): Response | null {
  const origin = request.headers.get("origin");
  if (!origin) {
    // Server-to-server (non-browser) may omit Origin; allow if no Origin but Host validated
    return null;
  }
  try {
    const originUrl = new URL(origin);
    const expectedUrl = new URL(expectedOrigin);
    if (origin !== originUrl.origin) return invalidRequest("Invalid Origin header.");
    if (originUrl.origin !== expectedUrl.origin) return invalidRequest("Invalid Origin header.", 403);
  } catch {
    return invalidRequest("Invalid Origin header.");
  }
  return null;
}

function validateRequestSize(request: Request, maxBytes = MAX_REQUEST_BODY_BYTES): Response | null {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const len = Number(contentLength);
    if (!Number.isSafeInteger(len) || len < 0) return invalidRequest("Invalid Content-Length header.");
    if (len > maxBytes) return invalidRequest("Request body too large.", 413);
  }
  return null;
}

async function limitRequestBody(request: Request): Promise<Request | Response> {
  if (!request.body) return request;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_REQUEST_BODY_BYTES) {
      await reader.cancel();
      return invalidRequest("Request body too large.", 413);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request, { body });
}

function validateProtocolVersion(request: Request): Response | null {
  if (request.method !== "POST") return null;
  const header = request.headers.get("mcp-protocol-version");
  if (header === null) {
    return invalidRequest(`MCP-Protocol-Version must be ${MCP_PROTOCOL_VERSION}.`);
  }
  if (header !== MCP_PROTOCOL_VERSION) {
    return invalidRequest(`MCP-Protocol-Version must be ${MCP_PROTOCOL_VERSION}.`);
  }
  return null;
}

async function rejectUnsupportedSubscription(request: Request): Promise<Response | null> {
  const body = await request.clone().json().catch(() => null) as { id?: unknown; method?: unknown } | null;
  if (!body || body.method !== "subscriptions/listen") return null;

  if (!("id" in body)) return new Response(null, { status: 202 });

  return Response.json({
    jsonrpc: "2.0",
    id: body.id,
    error: {
      code: -32601,
      message: "Method not found: subscriptions/listen",
    },
  });
}

export function createWebMcpHandler(
  registerServer: (server: McpServer, authInfo?: AuthInfo) => void,
  options: TransportOptions,
): RequestHandler {
  const policy = mcpOriginPolicy(options.resourceUrl);
  const { expectedHost, expectedOrigin } = policy;

  // Single canonical modern handler — stateless, per-request factory, no Mcp-Session-Id.
  const handler = createMcpHandler(
    (ctx) => {
      const server = new RuntimeMcpServer(
        { name: "ega-house", version: "0.1.0" },
        {
          capabilities: { tools: {} },
          requestState: {
            verify: async (token: string) => {
              const { createRequestStateCodec, getRequestStateSecret } = await import("@/lib/mcp/request-state");
              const codec = createRequestStateCodec({ key: getRequestStateSecret(), ttlSeconds: 300 });
              return codec.verify(token);
            },
          },
          // No cast. `requestState` is a declared member of the SDK's
          // ServerOptions, verified against both 2.0.0 and 2.3.0 typings, so the
          // `as unknown as` that used to sit here was suppressing type checking
          // over this whole object - including the exact field the MRTR
          // confirmation flow depends on - for nothing. A future rename now
          // fails at compile time instead of at runtime.
        },
      );
      registerServer(server, ctx.authInfo);
      return server;
    },
    {
      legacy: "reject",
    },
  );

  return async (request: Request): Promise<Response> => {
    // Explicit Host/Origin validation BEFORE auth and before handler — not delegated to createMcpHandler
    const hostError = validateMcpHost(request, expectedHost);
    if (hostError) return hostError;
    const originError = validateMcpOrigin(request, expectedOrigin);
    if (originError) return originError;

    /**
     * Host and Origin are accepted from here on, so every response below carries
     * the same origin contract — including the refusals. Those four paths used to
     * return bare: the `subscriptions/listen` -32601 and the oversized-body 413
     * reached a browser client with no allow-origin at all, so it read an opaque
     * CORS failure instead of the error the server actually produced; and the 405
     * carried neither `Vary: Origin` nor `Cache-Control`, and 405 is
     * heuristically cacheable (RFC 9110 15.1), so a shared cache could reuse it.
     */
    const decided = (response: Response): Response => {
      const headers = new Headers(response.headers);
      applyMcpCorsHeaders(request, headers, expectedOrigin);
      return new Response(response.body, { status: response.status, headers });
    };

    const protocolError = validateProtocolVersion(request);
    if (protocolError) return decided(protocolError);
    const sizeError = validateRequestSize(request);
    if (sizeError) return decided(sizeError);

    // Correct POST/OPTIONS/GET behavior for modern stateless:
    // GET is 405 (stateless has no session), but server/discover is POST with _meta
    if (request.method === "OPTIONS") {
      // Unreachable through the production route, which answers preflight before
      // auth (a browser preflight carries no Authorization header). Kept so that
      // calling this exported factory directly still cannot become a second,
      // less-guarded preflight: it is the same function, with the same policy.
      return createMcpPreflightResponse(request, policy);
    }
    if (request.method !== "POST") {
      return decided(new Response(null, {
        status: 405,
        headers: { Allow: MCP_ALLOWED_METHODS },
      }));
    }

    // Auth is pass-through: withEgaMcpAuth verified the bearer token before
    // calling us and attached the result to the request. Read it through the
    // canonical accessor rather than casting the request again, so there is one
    // reader of this state instead of an accessor and a competing inline cast.
    const authInfo = getMcpRequestAuthInfo(request);
    const limitedRequest = await limitRequestBody(request);
    if (limitedRequest instanceof Response) return decided(limitedRequest);

    const unsupportedSubscription = await rejectUnsupportedSubscription(limitedRequest);
    if (unsupportedSubscription) return decided(unsupportedSubscription);

    // Modern headers Mcp-Method/Mcp-Name are routing/validation, not authorization — never use them for auth
    // The SDK's createMcpHandler validates them against body; we just ensure we don't treat them as auth
    // No authorization derived from Mcp-Method/Mcp-Name/Mcp-Param-* or body owner fields

    // No cast: McpHttpHandler.fetch is already
  // (request, options?: { authInfo?: AuthInfo; parsedBody?: unknown }) => Promise<Response>.
  // The cast suppressed type checking over the AUTHENTICATION hand-off, which is
  // the one place where a silent rename would drop authInfo and leave every
  // request with zero registered tools.
  const response = await handler.fetch(
    limitedRequest,
    authInfo ? { authInfo } : undefined,
  );
  return decided(response);
  };
}
