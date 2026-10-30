import { getMcpRuntimeConfig, type McpRuntimeConfig } from "@/lib/mcp/config";
import {
  createMcpRouteRuntime,
  type McpRouteRuntime,
} from "@/lib/mcp/route-runtime";

type McpEndpointEnvironment = {
  MCP_ENABLED?: string;
};

type McpEndpointDependencies = {
  getEnvironment: () => McpEndpointEnvironment;
  getConfig: () => McpRuntimeConfig;
  buildRuntime: (config: McpRuntimeConfig) => McpRouteRuntime;
};

const DEFAULT_DEPENDENCIES: McpEndpointDependencies = {
  getEnvironment: () => process.env as McpEndpointEnvironment,
  getConfig: getMcpRuntimeConfig,
  buildRuntime: createMcpRouteRuntime,
};

function disabledResponse(): Response {
  return Response.json(
    {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "MCP endpoint is disabled.",
      },
    },
    {
      status: 404,
      // 404 is heuristically cacheable (RFC 9110 15.1) and this route is
      // origin-dependent, so an intermediary was free to store "MCP is
      // disabled" and keep serving it after the endpoint was enabled - a config
      // change that would not take effect until the entry expired. `Vary: Origin`
      // is present for the same reason it is on the enabled path: the response
      // is decided for this origin and must not be replayed for another.
      headers: { "Cache-Control": "no-store", Vary: "Origin" },
    },
  );
}

export function createLazyMcpEndpoint(
  dependencies: McpEndpointDependencies = DEFAULT_DEPENDENCIES,
) {
  let runtime: McpRouteRuntime | undefined;

  function isEnabled(): boolean {
    return dependencies.getEnvironment().MCP_ENABLED === "true";
  }

  function getRuntime(): McpRouteRuntime {
    if (!runtime) {
      runtime = dependencies.buildRuntime(dependencies.getConfig());
    }
    return runtime;
  }

  return {
    async GET(request: Request): Promise<Response> {
      if (!isEnabled()) return disabledResponse();
      return await getRuntime().GET(request);
    },

    async POST(request: Request): Promise<Response> {
      if (!isEnabled()) return disabledResponse();
      return await getRuntime().POST(request);
    },

    async OPTIONS(request: Request): Promise<Response> {
      if (!isEnabled()) return disabledResponse();
      return await getRuntime().OPTIONS(request);
    },
  };
}
