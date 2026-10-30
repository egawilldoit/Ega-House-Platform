import { describe, expect, it, vi } from "vitest";

import type { McpRouteRuntime } from "@/lib/mcp/route-runtime";
import { createLazyMcpEndpoint } from "@/lib/mcp/endpoint";

function createRuntime(): McpRouteRuntime {
  return {
    GET: vi.fn().mockResolvedValue(new Response("get")),
    POST: vi.fn().mockResolvedValue(new Response("post")),
    OPTIONS: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
  };
}

describe("createLazyMcpEndpoint", () => {
  it("returns 404 without loading configuration when MCP is disabled", async () => {
    const getConfig = vi.fn();
    const buildRuntime = vi.fn();
    const endpoint = createLazyMcpEndpoint({
      getEnvironment: () => ({ MCP_ENABLED: "false" }),
      getConfig,
      buildRuntime,
    });

    const response = await endpoint.POST(
      new Request("https://ega.example.com/api/mcp", { method: "POST" }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: "MCP endpoint is disabled." },
    });
    expect(getConfig).not.toHaveBeenCalled();
    expect(buildRuntime).not.toHaveBeenCalled();
  });

  it.each(["GET", "POST", "OPTIONS"])(
    "marks the disabled %s response uncacheable",
    async (method) => {
      // 404 is heuristically cacheable (RFC 9110 15.1). Without no-store an
      // intermediary could store "MCP is disabled" and keep serving it after the
      // endpoint was enabled, so enabling it would not take effect until the
      // entry expired. Every method is covered because the disabled response is
      // produced on all three.
      const endpoint = createLazyMcpEndpoint({
        getEnvironment: () => ({ MCP_ENABLED: "false" }),
        getConfig: vi.fn(),
        buildRuntime: vi.fn(),
      });

      const response = await endpoint[method as "GET"](
        new Request("https://ega.example.com/api/mcp", { method }),
      );

      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("vary")).toBe("Origin");
      // The disabled response advertises no origin: the route is off, so there
      // is nothing for a browser to be permitted to reach.
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    },
  );

  it("does not let the disabled 404 be replayed for another origin", async () => {
    // The same observation as above from the CORS angle: `Vary: Origin` plus
    // no-store means the refusal cannot be served to a different origin from a
    // shared cache, and no allow-origin header is ever attached to it.
    const endpoint = createLazyMcpEndpoint({
      getEnvironment: () => ({ MCP_ENABLED: "false" }),
      getConfig: vi.fn(),
      buildRuntime: vi.fn(),
    });

    const response = await endpoint.OPTIONS(
      new Request("https://ega.example.com/api/mcp", {
        method: "OPTIONS",
        headers: { host: "ega.example.com", origin: "https://ega.example.com" },
      }),
    );

    expect(response.headers.get("vary")).toContain("Origin");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("never consults the kill switch through anything but MCP_ENABLED === 'true'", async () => {
    // `config.enabled` exists and is read by the OAuth decision route, but the
    // endpoint's own gate deliberately reads the raw flag instead, so it can
    // answer 404 without constructing configuration at all (which would throw
    // when the env is absent). This asserts that path stays a direct env read.
    for (const value of ["false", "TRUE", "1", "true ", "yes", undefined]) {
      const endpoint = createLazyMcpEndpoint({
        getEnvironment: () => ({ MCP_ENABLED: value }),
        getConfig: vi.fn(),
        buildRuntime: vi.fn().mockReturnValue(createRuntime()),
      });

      const response = await endpoint.POST(
        new Request("https://ega.example.com/api/mcp", { method: "POST" }),
      );

      expect(response.status, String(value)).toBe(404);
    }
  });

  it("does not enable from ambiguous flag values", async () => {
    const endpoint = createLazyMcpEndpoint({
      getEnvironment: () => ({ MCP_ENABLED: "TRUE" }),
      getConfig: vi.fn(),
      buildRuntime: vi.fn(),
    });

    await expect(
      endpoint.GET(new Request("https://ega.example.com/api/mcp")),
    ).resolves.toEqual(expect.objectContaining({ status: 404 }));
  });

  it("builds the runtime once and dispatches GET, POST, and OPTIONS", async () => {
    const runtime = createRuntime();
    const config = { marker: "config" };
    const getConfig = vi.fn().mockReturnValue(config);
    const buildRuntime = vi.fn().mockReturnValue(runtime);
    const endpoint = createLazyMcpEndpoint({
      getEnvironment: () => ({ MCP_ENABLED: "true" }),
      getConfig,
      buildRuntime,
    });
    const getRequest = new Request("https://ega.example.com/api/mcp");
    const postRequest = new Request("https://ega.example.com/api/mcp", {
      method: "POST",
    });

    await expect(endpoint.GET(getRequest)).resolves.toEqual(
      expect.objectContaining({ status: 200 }),
    );
    await expect(endpoint.POST(postRequest)).resolves.toEqual(
      expect.objectContaining({ status: 200 }),
    );
    const optionsRequest = new Request("https://ega.example.com/api/mcp", {
      method: "OPTIONS",
      headers: { host: "ega.example.com" },
    });
    await expect(endpoint.OPTIONS(optionsRequest)).resolves.toEqual(
      expect.objectContaining({ status: 204 }),
    );

    expect(getConfig).toHaveBeenCalledTimes(1);
    expect(buildRuntime).toHaveBeenCalledTimes(1);
    expect(buildRuntime).toHaveBeenCalledWith(config);
    expect(runtime.GET).toHaveBeenCalledWith(getRequest);
    expect(runtime.POST).toHaveBeenCalledWith(postRequest);
    // The request is forwarded, not discarded: preflight needs the Host and
    // Origin headers to apply the same policy the authenticated path applies.
    expect(runtime.OPTIONS).toHaveBeenCalledWith(optionsRequest);
  });
});
