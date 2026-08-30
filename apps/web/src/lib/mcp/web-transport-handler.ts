import type { McpServer } from "@modelcontextprotocol/server";
import { McpServer as RuntimeMcpServer, createMcpHandler } from "@modelcontextprotocol/server";
import type { AuthInfo } from "@modelcontextprotocol/server";


type RequestHandler = (request: Request) => Response | Promise<Response>;

type TransportOptions = {
  basePath: string;
  maxDuration: number;
  verboseLogs: boolean;
  resourceUrl: string;
};

const MCP_PROTOCOL_VERSION = "2026-07-28";
const MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024;

function invalidRequest(description: string, status: 400 | 403 | 413 | 421 = 400): Response {
  return Response.json(
    { error: "invalid_request", error_description: description },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function validateHost(request: Request, expectedHost: string): Response | null {
  const hostHeader = request.headers.get("host");
  if (!hostHeader) return invalidRequest("Missing Host header.");
  if (hostHeader.includes(",") || /[\s/#?@]/.test(hostHeader)) {
    return invalidRequest("Invalid Host header.");
  }

  let host: string;
  try {
    host = new URL(`http://${hostHeader}`).host;
  } catch {
    return invalidRequest("Invalid Host header.");
  }
  if (host !== expectedHost) return invalidRequest("Invalid Host header.", 421);
  return null;
}

function validateOrigin(request: Request, expectedOrigin: string): Response | null {
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

function validateRequestSize(request: Request, maxBytes = 4 * 1024 * 1024): Response | null {
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

function getResourceHostAndOrigin(resourceUrl: string) {
  const url = new URL(resourceUrl);
  return { host: url.host, origin: url.origin };
}

export function createWebMcpHandler(
  registerServer: (server: McpServer, authInfo?: AuthInfo) => void,
  _serverOptions: Record<string, never>,
  options: TransportOptions,
): RequestHandler {
  const { host: expectedHost, origin: expectedOrigin } = getResourceHostAndOrigin(options.resourceUrl);

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
        } as unknown as ConstructorParameters<typeof RuntimeMcpServer>[1],
      ) as unknown as McpServer;
      registerServer(server, ctx.authInfo);
      return server;
    },
    {
      legacy: "reject",
    },
  );

  return async (request: Request): Promise<Response> => {
    // Explicit Host/Origin validation BEFORE auth and before handler — not delegated to createMcpHandler
    const hostError = validateHost(request, expectedHost);
    if (hostError) return hostError;
    const originError = validateOrigin(request, expectedOrigin);
    if (originError) return originError;
    const protocolError = validateProtocolVersion(request);
    if (protocolError) return protocolError;
    const sizeError = validateRequestSize(request);
    if (sizeError) return sizeError;

    // Correct POST/OPTIONS/GET behavior for modern stateless:
    // GET is 405 (stateless has no session), but server/discover is POST with _meta
    if (request.method === "GET") {
      return new Response(null, {
        status: 405,
        headers: { Allow: "POST, OPTIONS" },
      });
    }
    if (request.method !== "POST" && request.method !== "OPTIONS") {
      return new Response(null, {
        status: 405,
        headers: { Allow: "POST, OPTIONS" },
      });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }

    // Auth is pass-through: withEgaMcpAuth wrapper will have verified and will call this handler
    // with authInfo via (request as AuthenticatedRequest).auth, but createMcpHandler expects
    // authInfo via handler.fetch(request, { authInfo }). We support both:
    // - If called via withEgaMcpAuth, request.auth is set and we extract it
    // - If called directly with handler.fetch(request, { authInfo }), we use that
    // For web-transport-handler's fetch, we are the inner handler after withEgaMcpAuth, so we read request.auth
    const authInfo = (request as Request & { auth?: AuthInfo }).auth;
    const limitedRequest = await limitRequestBody(request);
    if (limitedRequest instanceof Response) return limitedRequest;

    const unsupportedSubscription = await rejectUnsupportedSubscription(limitedRequest);
    if (unsupportedSubscription) return unsupportedSubscription;

    // Modern headers Mcp-Method/Mcp-Name are routing/validation, not authorization — never use them for auth
    // The SDK's createMcpHandler validates them against body; we just ensure we don't treat them as auth
    // No authorization derived from Mcp-Method/Mcp-Name/Mcp-Param-* or body owner fields

    return (handler.fetch as unknown as (r: Request, o?: unknown) => Promise<Response>)(limitedRequest, authInfo ? { authInfo } : undefined);
  };
}
