import type { McpServer } from "@modelcontextprotocol/server";
import { McpServer as RuntimeMcpServer, createMcpHandler } from "@modelcontextprotocol/server";
import {
  WebStandardStreamableHTTPServerTransport,
  type WebStandardStreamableHTTPServerTransportOptions,
} from "@modelcontextprotocol/server";

import { getMcpRequestAuthInfo } from "@/lib/mcp/http-auth";
import { filterToolsByPermissions } from "@/lib/mcp/tool-discovery";
import { readPrincipalFromAuthInfo } from "@/lib/mcp/auth-info";

type RequestHandler = (request: Request) => Response | Promise<Response>;

type TransportOptions = {
  basePath: string;
  maxDuration: number;
  verboseLogs: boolean;
  resourceUrl: string;
};

type ServerLike = {
  connect: (transport: TransportLike) => Promise<void>;
  close: () => Promise<void>;
};

type TransportLike = {
  handleRequest: (
    request: Request,
    options: { authInfo: ReturnType<typeof getMcpRequestAuthInfo> },
  ) => Promise<Response>;
  close: () => Promise<void>;
};

export type WebMcpHandlerDependencies = {
  createServer: () => ServerLike;
  createTransport: (
    options: WebStandardStreamableHTTPServerTransportOptions,
  ) => TransportLike;
};

const DEFAULT_DEPENDENCIES: WebMcpHandlerDependencies = {
  createServer: () =>
    new RuntimeMcpServer({
      name: "ega-house",
      version: "0.1.0",
    }) as unknown as ServerLike,
  createTransport: (options) =>
    new WebStandardStreamableHTTPServerTransport(options) as unknown as TransportLike,
};

function validateModernHeaders(request: Request): Response | null {
  const protocolVersion = request.headers.get("MCP-Protocol-Version");
  const mcpMethod = request.headers.get("Mcp-Method");
  const mcpName = request.headers.get("Mcp-Name");
  // If any modern header present, body must be modern; transport will validate agreement with body.
  // Here we only ensure that Mcp-Method/Mcp-Name are not used to authorize (never as auth source).
  // We intentionally do not authorize via these headers.
  if (protocolVersion && !mcpMethod) {
    // Missing required Mcp-Method for modern request — transport will return -32020,
    // but we ensure we don't treat headers as auth.
  }
  return null;
}

function createModernHandler(
  registerServer: (server: McpServer) => void,
  resourceUrl: string,
): RequestHandler {
  // 2026-07-28 modern entry — stateless createMcpHandler with private caching for server/discover
  // This is the canonical 2026-07-28 serving path; legacy WebStandard transport remains as fallback
  // until full cutover. Both are stateless (no Mcp-Session-Id).
  try {
    const handler = createMcpHandler(
      () => {
        const server = new RuntimeMcpServer({ name: "ega-house", version: "0.1.0" }) as unknown as McpServer;
        registerServer(server);
        return server as unknown as McpServer;
      },
      {
        legacy: "stateless",
      } as unknown as Parameters<typeof createMcpHandler>[1],
    );
    return async (request: Request) => {
      const headerError = validateModernHeaders(request);
      if (headerError) return headerError;
      // createMcpHandler's fetch handles server/discover (ttlMs 0, cacheScope private) and modern header validation
      return handler.fetch(request);
    };
  } catch {
    return async () => new Response(JSON.stringify({ ok: false, error: { code: "INTERNAL_ERROR" } }), { status: 500 });
  }
}

export function createWebMcpHandler(
  registerServer: (server: McpServer) => void,
  _serverOptions: Record<string, never>,
  options: TransportOptions,
  dependencies: WebMcpHandlerDependencies = DEFAULT_DEPENDENCIES,
): RequestHandler {
  const resource = new URL(options.resourceUrl);

  // If modern handler env is enabled, delegate to createMcpHandler path (2026-07-28)
  if (process.env.MCP_USE_CREATE_HANDLER === "true") {
    return createModernHandler(registerServer, options.resourceUrl);
  }

  return async (request: Request): Promise<Response> => {
    if (request.method === "GET") {
      return new Response(null, {
        status: 405,
        headers: { Allow: "POST, OPTIONS" },
      });
    }

    if (request.method !== "POST") {
      return new Response(null, {
        status: 405,
        headers: { Allow: "POST, OPTIONS" },
      });
    }

    const headerError = validateModernHeaders(request);
    if (headerError) return headerError;

    const authInfo = getMcpRequestAuthInfo(request);
    // Permission-aware tool filtering: don't advertise writes to read_only
    // We achieve this by wrapping registerServer to filter based on principal
    // For now, we still register all, but handlers will enforce PERMISSION_DENIED.
    // The filter below is the intended per-principal discovery (next increment wires it fully):
    // const principal = authInfo ? readPrincipalFromAuthInfo(authInfo) : null;
    // const allowed = principal ? filterToolsByPermissions(principal.permissions, process.env.MCP_WRITES_ENABLED === "true") : [];
    const server = dependencies.createServer();
    const transport = dependencies.createTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts: [resource.host],
      allowedOrigins: [resource.origin],
    });

    // Intentionally not filtering at registration yet — handlers enforce permission.
    // The helper above (filterToolsByPermissions) is the mechanism for tools/list
    // to hide unauthorized writes; full per-principal server factory will be
    // enabled when createMcpHandler cutover is complete.
    registerServer(server as unknown as McpServer);
    await server.connect(transport);

    try {
      return await transport.handleRequest(request, {
        authInfo,
      });
    } finally {
      await transport.close();
      await server.close();
    }
  };
}
