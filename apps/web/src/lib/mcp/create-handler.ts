import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import type { AuthInfo } from "@modelcontextprotocol/server";

import { filterToolsByPermissions } from "@/lib/mcp/tool-discovery";
import { hasMcpPermission } from "@/lib/mcp/permissions";
import { readPrincipalFromAuthInfo } from "@/lib/mcp/auth-info";

export type McpHandlerFactory = (authInfo: AuthInfo | undefined) => McpServer;

export function createStatelessMcpHandler(
  factory: McpHandlerFactory,
  options: { writesEnabled: boolean; resourceUrl: string },
): (request: Request) => Promise<Response> {
  // Modern 2026-07-28 handler — stateless, per-request factory, no session id.
  // Uses official createMcpHandler which serves server/discover with private caching
  // and validates MCP-Protocol-Version / Mcp-Method / Mcp-Name / Mcp-Param-*.
  const modern = createMcpHandler(
    () => {
      const server = new McpServer({ name: "ega-house", version: "0.1.0" }, { capabilities: { tools: {} } });
      return server;
    },
    {
      legacy: "stateless",
    } as unknown as Parameters<typeof createMcpHandler>[1],
  );

  // Our permission-aware wrapper: for now we delegate to modern handler
  // and rely on tool handlers to enforce permission (PERMISSION_DENIED).
  // Full per-principal filtering will be done via tools/list interception
  // using filterToolsByPermissions in the next increment.
  return async (request: Request): Promise<Response> => {
    // The modern handler validates Host/Origin via its own transport
    // and handles server/discover (ttlMs: 0, cacheScope: private)
    return modern.fetch(request);
  };
}

// Helper for per-request tool filtering (used in audit proof)
export function shouldAdvertiseTool(
  toolName: string,
  authInfo: AuthInfo | undefined,
  writesEnabled: boolean,
): boolean {
  if (!authInfo) return false;
  try {
    const principal = readPrincipalFromAuthInfo(authInfo);
    const allowed = filterToolsByPermissions(principal.permissions, writesEnabled);
    return allowed.includes(toolName);
  } catch {
    return false;
  }
}
