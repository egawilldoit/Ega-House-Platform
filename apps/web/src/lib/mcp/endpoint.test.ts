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
    await expect(endpoint.OPTIONS()).resolves.toEqual(
      expect.objectContaining({ status: 204 }),
    );

    expect(getConfig).toHaveBeenCalledTimes(1);
    expect(buildRuntime).toHaveBeenCalledTimes(1);
    expect(buildRuntime).toHaveBeenCalledWith(config);
    expect(runtime.GET).toHaveBeenCalledWith(getRequest);
    expect(runtime.POST).toHaveBeenCalledWith(postRequest);
    expect(runtime.OPTIONS).toHaveBeenCalledTimes(1);
  });
});
