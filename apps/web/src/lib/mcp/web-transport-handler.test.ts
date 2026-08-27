import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";

import { createWebMcpHandler } from "@/lib/mcp/web-transport-handler";
import { getMcpRequestAuthInfo } from "@/lib/mcp/http-auth";

const AUTH_INFO: AuthInfo = {
  token: "signed-token",
  clientId: "test-mcp-client",
  scopes: ["ega.mcp.authorized"],
};

describe("createWebMcpHandler", () => {
  it("creates and closes a fresh stateless server and transport per POST", async () => {
    const server = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const transport = {
      handleRequest: vi.fn().mockResolvedValue(Response.json({ ok: true })),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const dependencies = {
      createServer: vi.fn().mockReturnValue(server),
      createTransport: vi.fn().mockReturnValue(transport),
    };
    const register = vi.fn();
    const handler = createWebMcpHandler(
      register,
      {},
      {
        basePath: "/api",
        maxDuration: 60,
        verboseLogs: false,
        resourceUrl: "https://ega.example.com/api/mcp",
      },
      dependencies,
    );
    const request = new Request("https://ega.example.com/api/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
      headers: { "content-type": "application/json" },
    });
    Object.defineProperty(request, "auth", { value: AUTH_INFO });

    const response = await handler(request);

    expect(response.status).toBe(200);
    expect(dependencies.createServer).toHaveBeenCalledTimes(1);
    expect(dependencies.createTransport).toHaveBeenCalledWith({
      allowedHosts: ["ega.example.com"],
      allowedOrigins: ["https://ega.example.com"],
      enableDnsRebindingProtection: true,
      enableJsonResponse: true,
      sessionIdGenerator: undefined,
    });
    expect(register).toHaveBeenCalledWith(server as unknown as McpServer);
    expect(server.connect).toHaveBeenCalledWith(transport);
    expect(transport.handleRequest).toHaveBeenCalledWith(request, {
      authInfo: getMcpRequestAuthInfo(request),
    });
    expect(transport.close).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it("rejects GET because this deployment is stateless JSON-only", async () => {
    const dependencies = {
      createServer: vi.fn(),
      createTransport: vi.fn(),
    };
    const handler = createWebMcpHandler(
      vi.fn(),
      {},
      {
        basePath: "/api",
        maxDuration: 60,
        verboseLogs: false,
        resourceUrl: "https://ega.example.com/api/mcp",
      },
      dependencies,
    );

    const response = await handler(
      new Request("https://ega.example.com/api/mcp", { method: "GET" }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, OPTIONS");
    expect(dependencies.createServer).not.toHaveBeenCalled();
  });
});
