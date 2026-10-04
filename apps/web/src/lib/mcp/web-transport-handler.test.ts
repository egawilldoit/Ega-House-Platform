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

  describe("preflight and POST share one origin policy", () => {
    const RESOURCE_ORIGIN = "https://ega.example.com";

    /**
     * The regression this pins: preflight used to answer
     * `Access-Control-Allow-Origin: *` and skip Host/Origin validation entirely,
     * while POST validated the exact resource origin. A browser on any other
     * origin was told it was allowed and then received 403.
     *
     * Each case asserts the same decision is reached on both paths, so the two
     * cannot drift apart again without failing here.
     */
    it.each([
      // A refused origin need not share one status: an unparseable Origin is a
      // malformed request (400) while a parseable mismatch is forbidden (403).
      // The invariant under test is that preflight and POST agree, and that a
      // refused origin is never advertised as allowed.
      ["matching browser origin", RESOURCE_ORIGIN, true],
      ["foreign browser origin", "https://evil.example", false],
      ["no origin (server to server)", undefined, true],
      ["opaque origin", "null", false],
    ])("%s", async (_label, origin, allowed) => {
      const headers = new Headers();
      headers.set("host", "ega.example.com");
      if (origin !== undefined) headers.set("origin", origin);

      const preflightResponse = await createHandler()(
        new Request("https://ega.example.com/api/mcp", { method: "OPTIONS", headers }),
      );

      const postHeaders = new Headers(MCP_HEADERS);
      postHeaders.set("host", "ega.example.com");
      if (origin !== undefined) postHeaders.set("origin", origin);
      const postResponse = await createHandler()(
        createRequest({ jsonrpc: "2.0", id: 1, method: "ping" }, postHeaders),
      );

      // The POST may still be refused further downstream (a bare ping is not a
      // complete MCP session), so the assertion is about the ORIGIN decision
      // specifically: both paths must reach the same verdict, and a refused
      // origin must never be advertised as allowed.
      const postBody = await postResponse.clone().text();

      if (allowed) {
        expect(preflightResponse.status).toBe(204);
        expect(postBody).not.toContain("Origin");
        expect(postResponse.headers.get("access-control-allow-origin")).not.toBe("*");
      } else {
        expect(preflightResponse.status).toBe(postResponse.status);
        expect(preflightResponse.status).toBeGreaterThanOrEqual(400);
        expect(postBody).toContain("Origin");
        expect(preflightResponse.headers.get("access-control-allow-origin")).toBeNull();
      }
    });

    it("never returns a wildcard allow-origin on the matching-origin preflight", async () => {
      const headers = new Headers({ host: "ega.example.com", origin: RESOURCE_ORIGIN });
      const response = await createHandler()(
        new Request("https://ega.example.com/api/mcp", { method: "OPTIONS", headers }),
      );

      expect(response.headers.get("access-control-allow-origin")).toBe(RESOURCE_ORIGIN);
      expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
      expect(response.headers.get("vary")).toBe("Origin");
    });

    it("applies Host validation to preflight, which previously skipped it entirely", async () => {
      const headers = new Headers({ host: "ega.example.com.evil", origin: RESOURCE_ORIGIN });
      const response = await createHandler()(
        new Request("https://ega.example.com/api/mcp", { method: "OPTIONS", headers }),
      );

      expect(response.status).toBe(421);
    });
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
