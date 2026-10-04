import type { McpServer } from "@modelcontextprotocol/server";
import type { AuthInfo } from "@modelcontextprotocol/server";
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
    aggregateRateLimits: { read: 0, write: 0, sensitive_write: 0 },
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

  it("registers no fallback tools when auth information is absent or malformed", () => {
    let registerServer: ((server: McpServer, authInfo?: AuthInfo) => void) | undefined;
    const dependencies: McpRouteRuntimeDependencies = {
      createReadHandlers: vi.fn().mockReturnValue({ marker: "handlers" }),
      registerReadTools: vi.fn(),
      registerToolsForPrincipal: vi.fn(),
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
    registerServer!(server, { token: "token", clientId: "client", scopes: [], extra: { principal: { ownerUserId: "owner" } } });

    expect(dependencies.registerReadTools).not.toHaveBeenCalled();
    expect(dependencies.registerToolsForPrincipal).not.toHaveBeenCalled();
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

  describe("preflight and POST express one origin policy", () => {
    const RESOURCE_ORIGIN = "https://ega.example.com";
    const RESOURCE_HOST = "ega.example.com";

    function runtime() {
      const dependencies: McpRouteRuntimeDependencies = {
        createReadHandlers: vi.fn().mockReturnValue({}),
        registerReadTools: vi.fn(),
        createTransportHandler: vi.fn().mockReturnValue(vi.fn()),
        createTokenVerifier: vi.fn().mockReturnValue(vi.fn()),
        wrapAuth: vi.fn().mockReturnValue(vi.fn()),
      };
      return createMcpRouteRuntime(CONFIG, dependencies);
    }

    function preflight(init: { origin?: string; host?: string } = {}): Request {
      const headers = new Headers();
      if (init.origin !== undefined) headers.set("origin", init.origin);
      headers.set("host", init.host ?? RESOURCE_HOST);
      return new Request(`${CONFIG.resource}#preflight`, { method: "OPTIONS", headers });
    }

    it("echoes the resource origin for a matching browser origin, never a wildcard", async () => {
      const response = await runtime().OPTIONS(preflight({ origin: RESOURCE_ORIGIN }));

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe(RESOURCE_ORIGIN);
      expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
      expect(response.headers.get("vary")).toBe("Origin");
      expect(response.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
      expect(response.headers.get("access-control-allow-headers")).toBe(
        "Authorization, Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
      );
    });

    it("refuses a foreign browser origin instead of advertising it as allowed", async () => {
      const response = await runtime().OPTIONS(preflight({ origin: "https://evil.example" }));

      // The browser only needs the missing allow-origin header to block the
      // request; a 403 additionally makes the refusal unambiguous.
      expect(response.status).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("allows a server-to-server preflight with no Origin", async () => {
      const response = await runtime().OPTIONS(preflight());

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(response.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    });

    it("refuses a preflight whose Host does not match the resource", async () => {
      const response = await runtime().OPTIONS(
        preflight({ origin: RESOURCE_ORIGIN, host: "ega.example.com.evil" }),
      );

      expect(response.status).toBe(421);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("never emits Access-Control-Allow-Credentials, so a wildcard could not be reintroduced", async () => {
      const response = await runtime().OPTIONS(preflight({ origin: RESOURCE_ORIGIN }));

      // Auth is a Bearer token, not a cookie, so credentialed CORS is neither
      // needed nor wanted here. Asserting its absence pins the decision.
      expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    });
  });
});
