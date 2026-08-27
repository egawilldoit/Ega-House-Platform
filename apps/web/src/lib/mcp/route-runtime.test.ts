import type { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

import { MCP_AUTHORIZED_SCOPE } from "@/lib/mcp/auth-info";
import {
  createMcpRouteRuntime,
  type McpRouteRuntimeDependencies,
} from "@/lib/mcp/route-runtime";

const CONFIG = {
  enabled: true,
  writesEnabled: false,
  resource: "https://ega.example.com/api/mcp",
  issuer: "https://example.supabase.co/auth/v1",
  supabaseUrl: "https://example.supabase.co",
  publishableKey: "publishable-key",
};

describe("createMcpRouteRuntime", () => {
  it("builds one authenticated Streamable HTTP handler", async () => {
    const transportResponse = new Response("transport");
    const authenticatedResponse = new Response("authenticated");
    const transportHandler = vi.fn().mockResolvedValue(transportResponse);
    const authenticatedHandler = vi.fn().mockResolvedValue(authenticatedResponse);
    const verifyToken = vi.fn();
    const handlers = { marker: "read-handlers" };
    const dependencies: McpRouteRuntimeDependencies = {
      createReadHandlers: vi.fn().mockReturnValue(handlers),
      registerReadTools: vi.fn(),
      createTransportHandler: vi.fn().mockReturnValue(transportHandler),
      createTokenVerifier: vi.fn().mockReturnValue(verifyToken),
      wrapAuth: vi.fn().mockReturnValue(authenticatedHandler),
    };

    const runtime = createMcpRouteRuntime(CONFIG, dependencies);
    const request = new Request(CONFIG.resource, { method: "POST" });

    await expect(runtime.POST(request)).resolves.toBe(authenticatedResponse);
    expect(dependencies.createReadHandlers).toHaveBeenCalledWith(CONFIG);
    expect(dependencies.createTransportHandler).toHaveBeenCalledWith(
      expect.any(Function),
      {},
      {
        basePath: "/api",
        maxDuration: 60,
        verboseLogs: false,
        resourceUrl: CONFIG.resource,
      },
    );
    expect(dependencies.createTokenVerifier).toHaveBeenCalledWith(CONFIG);
    expect(dependencies.wrapAuth).toHaveBeenCalledWith(
      transportHandler,
      verifyToken,
      {
        required: true,
        requiredScopes: [MCP_AUTHORIZED_SCOPE],
        resourceMetadataPath: "/.well-known/oauth-protected-resource",
        resourceUrl: "https://ega.example.com",
      },
    );
  });

  it("registers the configured read handlers on the transport server", () => {
    let registerServer: ((server: McpServer) => void) | undefined;
    const dependencies: McpRouteRuntimeDependencies = {
      createReadHandlers: vi.fn().mockReturnValue({ marker: "handlers" }),
      registerReadTools: vi.fn(),
      createTransportHandler: vi.fn((register) => {
        registerServer = register;
        return vi.fn();
      }),
      createTokenVerifier: vi.fn().mockReturnValue(vi.fn()),
      wrapAuth: vi.fn().mockReturnValue(vi.fn()),
    };

    createMcpRouteRuntime(CONFIG, dependencies);
    const server = {} as McpServer;
    registerServer!(server);

    expect(dependencies.registerReadTools).toHaveBeenCalledWith(
      server,
      { marker: "handlers" },
    );
  });

  it("uses the same authenticated boundary for GET and POST", () => {
    const handler = vi.fn();
    const dependencies: McpRouteRuntimeDependencies = {
      createReadHandlers: vi.fn().mockReturnValue({}),
      registerReadTools: vi.fn(),
      createTransportHandler: vi.fn().mockReturnValue(vi.fn()),
      createTokenVerifier: vi.fn().mockReturnValue(vi.fn()),
      wrapAuth: vi.fn().mockReturnValue(handler),
    };

    const runtime = createMcpRouteRuntime(CONFIG, dependencies);

    expect(runtime.GET).toBe(handler);
    expect(runtime.POST).toBe(handler);
  });

  it("returns a credential-aware JSON-only preflight response", async () => {
    const dependencies: McpRouteRuntimeDependencies = {
      createReadHandlers: vi.fn().mockReturnValue({}),
      registerReadTools: vi.fn(),
      createTransportHandler: vi.fn().mockReturnValue(vi.fn()),
      createTokenVerifier: vi.fn().mockReturnValue(vi.fn()),
      wrapAuth: vi.fn().mockReturnValue(vi.fn()),
    };

    const response = await createMcpRouteRuntime(CONFIG, dependencies).OPTIONS();

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "POST, OPTIONS",
    );
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id",
    );
  });
});
