import type { AuthInfo } from "@modelcontextprotocol/server";
import type { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

import { createWebMcpHandler } from "@/lib/mcp/web-transport-handler";
import { getMcpRequestAuthInfo } from "@/lib/mcp/http-auth";

const AUTH_INFO: AuthInfo = {
  token: "signed-token",
  clientId: "hermes-client",
  scopes: ["ega.mcp.authorized"],
};

const MCP_HEADERS = {
  "content-type": "application/json",
  host: "ega.example.com",
  "mcp-protocol-version": "2026-07-28",
};

function createLegacyHandler(transport = { handleRequest: vi.fn().mockResolvedValue(Response.json({ ok: true })), close: vi.fn().mockResolvedValue(undefined) }) {
  const server = { connect: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
  const dependencies = { createServer: vi.fn().mockReturnValue(server), createTransport: vi.fn().mockReturnValue(transport) };
  return { handler: createWebMcpHandler(vi.fn(), {}, { basePath: "/api", maxDuration: 60, verboseLogs: false, resourceUrl: "https://ega.example.com/api/mcp" }, dependencies), transport };
}

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
      headers: MCP_HEADERS,
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
    expect(register).toHaveBeenCalledWith(server as unknown as McpServer, AUTH_INFO);
    expect(server.connect).toHaveBeenCalledWith(transport);
    expect(transport.handleRequest).toHaveBeenCalledWith(expect.any(Request), {
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

  it("rejects a wrong MCP protocol version", async () => {
    const { handler, transport } = createLegacyHandler();
    const headers = new Headers({ "content-type": "application/json", host: "ega.example.com" });
    headers.set("mcp-protocol-version", "2025-06-18");

    const response = await handler(new Request("https://ega.example.com/api/mcp", {
      method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    }));

    expect(response.status).toBe(400);
    expect(transport.handleRequest).not.toHaveBeenCalled();
  });

  it("allows legacy stateless request without MCP-Protocol-Version", async () => {
    const { handler, transport } = createLegacyHandler();
    const headers = new Headers({ "content-type": "application/json", host: "ega.example.com" });

    const response = await handler(new Request("https://ega.example.com/api/mcp", {
      method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    }));

    expect(response.status).toBe(200);
    expect(transport.handleRequest).toHaveBeenCalled();
  });

  it("rejects an oversized streamed body without Content-Length", async () => {
    const { handler, transport } = createLegacyHandler();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4 * 1024 * 1024));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });

    const response = await handler(new Request("https://ega.example.com/api/mcp", {
      method: "POST", headers: MCP_HEADERS, body: stream, duplex: "half",
    } as RequestInit & { duplex: "half" }));

    expect(response.status).toBe(413);
    expect(transport.handleRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["ega.example.com.evil", undefined, 421],
    ["ega.example.com/path", undefined, 400],
    ["ega.example.com", "https://ega.example.com/path", 400],
    ["ega.example.com", "null", 400],
  ])("strictly rejects malformed or mismatched Host/Origin values", async (host, origin, status) => {
    const { handler } = createLegacyHandler();
    const headers = new Headers(MCP_HEADERS);
    headers.set("host", host);
    if (origin) headers.set("origin", origin);

    const response = await handler(new Request("https://ega.example.com/api/mcp", {
      method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    }));

    expect(response.status).toBe(status);
  });

  describe("modern/legacy protocol version handling (production handler)", () => {
    function createProductionHandler() {
      return createWebMcpHandler(
        () => {},
        {},
        { basePath: "/api", maxDuration: 60, verboseLogs: false, resourceUrl: "https://ega.example.com/api/mcp" },
      );
    }

    it("modern + correct MCP-Protocol-Version → not rejected by pre-validation", async () => {
      const handler = createProductionHandler();
      const request = new Request("https://ega.example.com/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "ega.example.com",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": "ping",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} } } }),
      });
      Object.defineProperty(request, "auth", { value: AUTH_INFO });
      const response = await handler(request);
      expect(response.status).not.toBe(400);
    });

    it("modern + wrong header → 400 from pre-validation", async () => {
      const handler = createProductionHandler();
      const request = new Request("https://ega.example.com/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "ega.example.com",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} } } }),
      });
      Object.defineProperty(request, "auth", { value: AUTH_INFO });
      const response = await handler(request);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid_request" });
    });

    it("legacy stateless without header or envelope → PASS (200)", async () => {
      const handler = createProductionHandler();
      const request = new Request("https://ega.example.com/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "ega.example.com",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      });
      Object.defineProperty(request, "auth", { value: AUTH_INFO });
      const response = await handler(request);
      expect([200, 202].includes(response.status)).toBe(true);
    });

    it("legacy notification without header → 202", async () => {
      const handler = createProductionHandler();
      const request = new Request("https://ega.example.com/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "ega.example.com",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } }),
      });
      Object.defineProperty(request, "auth", { value: AUTH_INFO });
      const response = await handler(request);
      expect(response.status).toBe(202);
    });
  });
});
