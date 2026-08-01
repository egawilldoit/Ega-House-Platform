import { randomUUID } from "node:crypto";

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler, withMcpAuth } from "mcp-handler";

import { writeMcpAuditEvent } from "@/lib/mcp/audit-repository";
import { createAuditedMcpReadHandlers } from "@/lib/mcp/audited-read-handlers";
import { MCP_AUTHORIZED_SCOPE } from "@/lib/mcp/auth-info";
import type { McpRuntimeConfig } from "@/lib/mcp/config";
import { createMcpReadToolHandlers } from "@/lib/mcp/read-tool-handlers";
import {
  listMcpGoals,
  listMcpProjects,
  listMcpTasks,
} from "@/lib/mcp/read-repository";
import { createMcpHandlerTokenVerifier } from "@/lib/mcp/runtime-auth";
import {
  registerMcpReadTools,
  type McpReadToolHandlers,
} from "@/lib/mcp/server";
import { createMcpSupabaseClient } from "@/lib/mcp/supabase-user-client";

type RequestHandler = (request: Request) => Response | Promise<Response>;
type TokenVerifier = (
  request: Request,
  bearerToken?: string,
) => AuthInfo | undefined | Promise<AuthInfo | undefined>;

type TransportOptions = {
  basePath: string;
  maxDuration: number;
  verboseLogs: boolean;
};

type AuthOptions = {
  required: boolean;
  requiredScopes: string[];
  resourceMetadataPath: string;
  resourceUrl: string;
};

export type McpRouteRuntimeDependencies = {
  createReadHandlers: (config: McpRuntimeConfig) => McpReadToolHandlers;
  registerReadTools: (
    server: McpServer,
    handlers: McpReadToolHandlers,
  ) => void;
  createTransportHandler: (
    registerServer: (server: McpServer) => void,
    serverOptions: Record<string, never>,
    transportOptions: TransportOptions,
  ) => RequestHandler;
  createTokenVerifier: (config: McpRuntimeConfig) => TokenVerifier;
  wrapAuth: (
    handler: RequestHandler,
    verifyToken: TokenVerifier,
    options: AuthOptions,
  ) => RequestHandler;
};

function createReadHandlers(config: McpRuntimeConfig): McpReadToolHandlers {
  const createUserClient = (accessToken: string) =>
    createMcpSupabaseClient(accessToken, {
      supabaseUrl: config.supabaseUrl,
      publishableKey: config.publishableKey,
    });
  const baseHandlers = createMcpReadToolHandlers(
    {
      createUserClient,
      listProjects: listMcpProjects,
      listGoals: listMcpGoals,
      listTasks: listMcpTasks,
    },
    config.writesEnabled,
  );

  return createAuditedMcpReadHandlers(baseHandlers, {
    createUserClient,
    writeAudit: writeMcpAuditEvent,
    nowMs: () => performance.now(),
    createRequestId: randomUUID,
  });
}

const DEFAULT_DEPENDENCIES: McpRouteRuntimeDependencies = {
  createReadHandlers,
  registerReadTools: registerMcpReadTools,
  createTransportHandler: createMcpHandler as unknown as McpRouteRuntimeDependencies["createTransportHandler"],
  createTokenVerifier: createMcpHandlerTokenVerifier,
  wrapAuth: withMcpAuth as unknown as McpRouteRuntimeDependencies["wrapAuth"],
};

const PREFLIGHT_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id",
  "Access-Control-Max-Age": "86400",
};

export type McpRouteRuntime = {
  GET: RequestHandler;
  POST: RequestHandler;
  OPTIONS: () => Promise<Response>;
};

export function createMcpRouteRuntime(
  config: McpRuntimeConfig,
  dependencies: McpRouteRuntimeDependencies = DEFAULT_DEPENDENCIES,
): McpRouteRuntime {
  const readHandlers = dependencies.createReadHandlers(config);
  const transportHandler = dependencies.createTransportHandler(
    (server) => dependencies.registerReadTools(server, readHandlers),
    {},
    {
      basePath: "/api",
      maxDuration: 60,
      verboseLogs: false,
    },
  );
  const verifyToken = dependencies.createTokenVerifier(config);
  const authenticatedHandler = dependencies.wrapAuth(
    transportHandler,
    verifyToken,
    {
      required: true,
      requiredScopes: [MCP_AUTHORIZED_SCOPE],
      resourceMetadataPath: "/.well-known/oauth-protected-resource",
      resourceUrl: new URL(config.resource).origin,
    },
  );

  return {
    GET: authenticatedHandler,
    POST: authenticatedHandler,
    OPTIONS: async () =>
      new Response(null, {
        status: 204,
        headers: PREFLIGHT_HEADERS,
      }),
  };
}
