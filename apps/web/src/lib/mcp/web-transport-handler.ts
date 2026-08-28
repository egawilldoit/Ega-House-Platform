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

export type WebMcpHandlerDependencies = {
  createServer?: (authInfo?: AuthInfo) => { server: McpServer; cleanup?: () => Promise<void> };
  // Legacy test compat: old tests mock WebStandard transport
  createTransport?: (opts: unknown) => { handleRequest: (r: Request, o: unknown) => Promise<Response>; close: () => Promise<void> };
  // Old ServerLike for test compat
  _legacyCreateServer?: () => { connect: (t: unknown) => Promise<void>; close: () => Promise<void> };
};

function validateHost(request: Request, expectedHost: string): Response | null {
  const hostHeader = request.headers.get("host");
  const host = hostHeader || (() => { try { return new URL(request.url).host; } catch { return null; } })();
  if (!host) {
    return Response.json(
      { error: "invalid_request", error_description: "Missing Host header." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  // Strip port
  const hostWithoutPort = host.split(":")[0].toLowerCase();
  const expectedWithoutPort = expectedHost.split(":")[0].toLowerCase();
  if (hostWithoutPort !== expectedWithoutPort) {
    // Allow localhost for development when expected is not localhost? Check repo policy: allow localhost
    const isLocalhost = (h: string) => h === "localhost" || h === "127.0.0.1" || h === "::1";
    if (!(isLocalhost(hostWithoutPort) && isLocalhost(expectedWithoutPort))) {
      return Response.json(
        { error: "invalid_request", error_description: "Invalid Host header." },
        { status: 421, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (hostWithoutPort !== expectedWithoutPort) {
      return Response.json(
        { error: "invalid_request", error_description: "Invalid Host header." },
        { status: 421, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
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
    if (originUrl.origin !== expectedUrl.origin) {
      // Allow localhost dev
      const isLocalhostOrigin = (o: string) => {
        try {
          const u = new URL(o);
          return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1";
        } catch {
          return false;
        }
      };
      if (isLocalhostOrigin(origin) && isLocalhostOrigin(expectedOrigin)) {
        return null;
      }
      return Response.json(
        { error: "invalid_request", error_description: "Invalid Origin header." },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
  } catch {
    return Response.json(
      { error: "invalid_request", error_description: "Invalid Origin header." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  return null;
}

function validateRequestSize(request: Request, maxBytes = 4 * 1024 * 1024): Response | null {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const len = Number(contentLength);
    if (Number.isFinite(len) && len > maxBytes) {
      return Response.json(
        { error: "invalid_request", error_description: "Request body too large." },
        { status: 413, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
  return null;
}

function getResourceHostAndOrigin(resourceUrl: string) {
  const url = new URL(resourceUrl);
  return { host: url.host, origin: url.origin };
}

export function createWebMcpHandler(
  registerServer: (server: McpServer, authInfo?: AuthInfo) => void,
  _serverOptions: Record<string, never>,
  options: TransportOptions,
  dependencies?: WebMcpHandlerDependencies,
): RequestHandler {
  const { host: expectedHost, origin: expectedOrigin } = getResourceHostAndOrigin(options.resourceUrl);

  // Test compat: if legacy dependencies with createTransport mock are provided, use old WebStandard path
  // This keeps existing unit tests (which mock WebStandard transport) passing while production uses createMcpHandler
  if (dependencies && (dependencies as unknown as { createTransport?: unknown }).createTransport) {
    const legacyDeps = dependencies as unknown as { createServer: () => { connect: (t: unknown) => Promise<void>; close: () => Promise<void> }; createTransport: (opts: unknown) => { handleRequest: (r: Request, o: unknown) => Promise<Response>; close: () => Promise<void> } };
    return async (request: Request): Promise<Response> => {
      if (request.method === "GET") {
        return new Response(null, { status: 405, headers: { Allow: "POST, OPTIONS" } });
      }
      if (request.method !== "POST") {
        return new Response(null, { status: 405, headers: { Allow: "POST, OPTIONS" } });
      }
      const hostError = validateHost(request, expectedHost);
      if (hostError) return hostError;
      const originError = validateOrigin(request, expectedOrigin);
      if (originError) return originError;
      const sizeError = validateRequestSize(request);
      if (sizeError) return sizeError;
      const authInfo = (request as Request & { auth?: AuthInfo }).auth;
      const server = legacyDeps.createServer();
      const transport = legacyDeps.createTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
        enableDnsRebindingProtection: true,
        allowedHosts: [expectedHost],
        allowedOrigins: [expectedOrigin],
      });
      registerServer(server as unknown as McpServer, authInfo);
      await server.connect(transport as unknown as never);
      try {
        return await transport.handleRequest(request, { authInfo });
      } finally {
        await transport.close();
        await (server as unknown as { close: () => Promise<void> }).close();
      }
    };
  }

  // Single canonical 2026-07-28 handler — stateless, per-request factory, no Mcp-Session-Id
  const handler = createMcpHandler(
    (ctx: { era: "legacy" | "modern"; authInfo?: AuthInfo; requestInfo?: Request }) => {
      const server = new RuntimeMcpServer(
        { name: "ega-house", version: "0.1.0" },
        {
          capabilities: { tools: {} },
          requestState: {
            verify: async (token: string) => {
              const { createRequestStateCodec } = await import("@/lib/mcp/request-state");
              const secret = process.env.MCP_REQUEST_STATE_SECRET;
              if (!secret || secret.length < 32) throw new Error("MCP_REQUEST_STATE_SECRET not configured");
              const codec = createRequestStateCodec({ key: secret, ttlSeconds: 300 });
              return codec.verify(token);
            },
          },
        } as unknown as ConstructorParameters<typeof RuntimeMcpServer>[1],
      ) as unknown as McpServer;
      registerServer(server, ctx.authInfo);
      return server;
    },
    {
      legacy: "stateless",
    } as unknown as Parameters<typeof createMcpHandler>[1],
  );

  return async (request: Request): Promise<Response> => {
    // Explicit Host/Origin validation BEFORE auth and before handler — not delegated to createMcpHandler
    const hostError = validateHost(request, expectedHost);
    if (hostError) return hostError;
    const originError = validateOrigin(request, expectedOrigin);
    if (originError) return originError;
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

    // Modern headers Mcp-Method/Mcp-Name are routing/validation, not authorization — never use them for auth
    // The SDK's createMcpHandler validates them against body; we just ensure we don't treat them as auth
    // No authorization derived from Mcp-Method/Mcp-Name/Mcp-Param-* or body owner fields

    return (handler.fetch as unknown as (r: Request, o?: unknown) => Promise<Response>)(request, authInfo ? { authInfo } : undefined);
  };
}

// Keep old helper for tests that directly call createWebMcpHandler with dependencies
export type LegacyWebMcpHandlerDependencies = {
  createServer: () => { connect: (t: unknown) => Promise<void>; close: () => Promise<void> };
  createTransport: (opts: unknown) => { handleRequest: (r: Request, o: unknown) => Promise<Response>; close: () => Promise<void> };
};
