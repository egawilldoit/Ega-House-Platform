import type { AuthInfo } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import { createWebMcpHandler } from "@/lib/mcp/web-transport-handler";

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

function createHandler() {
  return createWebMcpHandler(
    () => {},
    {},
    {
      basePath: "/api",
      maxDuration: 60,
      verboseLogs: false,
      resourceUrl: "https://ega.example.com/api/mcp",
    },
  );
}

function createRequest(body: unknown, headers: HeadersInit = MCP_HEADERS) {
  const request = new Request("https://ega.example.com/api/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  Object.defineProperty(request, "auth", { value: AUTH_INFO });
  return request;
}

describe("createWebMcpHandler", () => {
  it("rejects GET because this deployment is modern stateless JSON-only", async () => {
    const response = await createHandler()(
      new Request("https://ega.example.com/api/mcp", {
        method: "GET",
        headers: { host: "ega.example.com" },
      }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, OPTIONS");
  });

  it.each(["2025-06-18", "2025-11-25"])(
    "rejects the unsupported MCP protocol version %s",
    async (version) => {
      const headers = new Headers(MCP_HEADERS);
      headers.set("mcp-protocol-version", version);

      const response = await createHandler()(createRequest(
        { jsonrpc: "2.0", id: 1, method: "ping" },
        headers,
      ));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid_request" });
    },
  );

  it("rejects a POST without MCP-Protocol-Version", async () => {
    const headers = new Headers(MCP_HEADERS);
    headers.delete("mcp-protocol-version");

    const response = await createHandler()(createRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      headers,
    ));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
  });

  it("accepts a modern protocol request", async () => {
    const response = await createHandler()(createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }, new Headers({ ...MCP_HEADERS, "mcp-method": "ping" })));

    expect(response.status).not.toBe(400);
  });

  it("rejects an unsupported subscription request without holding the function open", async () => {
    const response = await createHandler()(createRequest({
      jsonrpc: "2.0",
      id: 7,
      method: "subscriptions/listen",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: {
        code: -32601,
        message: "Method not found: subscriptions/listen",
      },
    });
  });

  it("rejects an oversized streamed body without Content-Length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4 * 1024 * 1024));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });

    const request = new Request("https://ega.example.com/api/mcp", {
      method: "POST",
      headers: MCP_HEADERS,
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    Object.defineProperty(request, "auth", { value: AUTH_INFO });

    const response = await createHandler()(request);

    expect(response.status).toBe(413);
  });

  it.each([
    ["ega.example.com.evil", undefined, 421],
    ["ega.example.com/path", undefined, 400],
    ["ega.example.com", "https://ega.example.com/path", 400],
    ["ega.example.com", "null", 400],
  ])("strictly rejects malformed or mismatched Host/Origin values", async (host, origin, status) => {
    const headers = new Headers(MCP_HEADERS);
    headers.set("host", host);
    if (origin) headers.set("origin", origin);

    const response = await createHandler()(createRequest(
      { jsonrpc: "2.0", id: 1, method: "ping" },
      headers,
    ));

    expect(response.status).toBe(status);
  });
});
