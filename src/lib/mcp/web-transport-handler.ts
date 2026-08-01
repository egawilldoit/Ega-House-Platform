import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpServer as RuntimeMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  WebStandardStreamableHTTPServerTransport,
  type WebStandardStreamableHTTPServerTransportOptions,
} from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { getMcpRequestAuthInfo } from "@/lib/mcp/http-auth";

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

export function createWebMcpHandler(
  registerServer: (server: McpServer) => void,
  _serverOptions: Record<string, never>,
  options: TransportOptions,
  dependencies: WebMcpHandlerDependencies = DEFAULT_DEPENDENCIES,
): RequestHandler {
  const resource = new URL(options.resourceUrl);

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

    const server = dependencies.createServer();
    const transport = dependencies.createTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts: [resource.host],
      allowedOrigins: [resource.origin],
    });

    registerServer(server as unknown as McpServer);
    await server.connect(transport);

    try {
      return await transport.handleRequest(request, {
        authInfo: getMcpRequestAuthInfo(request),
      });
    } finally {
      await transport.close();
      await server.close();
    }
  };
}
