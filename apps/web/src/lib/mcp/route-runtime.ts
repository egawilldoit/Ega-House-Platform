import { randomUUID } from "node:crypto";

import type { AuthInfo } from "@modelcontextprotocol/server";
import type { McpServer } from "@modelcontextprotocol/server";

import { writeMcpAuditEvent } from "@/lib/mcp/audit-repository";
import { createAuditedMcpReadHandlers } from "@/lib/mcp/audited-read-handlers";
import { MCP_AUTHORIZED_SCOPE } from "@/lib/mcp/auth-info";
import type { McpRuntimeConfig } from "@/lib/mcp/config";
import { withEgaMcpAuth } from "@/lib/mcp/http-auth";
import { consumeMcpRateLimit } from "@/lib/mcp/rate-limit-repository";
import { createMcpReadToolHandlers } from "@/lib/mcp/read-tool-handlers";
import {
  listMcpGoals,
  listMcpProjects,
  listMcpTasks,
} from "@/lib/mcp/read-repository";
import { createMcpHandlerTokenVerifier } from "@/lib/mcp/runtime-auth";
import {
  registerMcpReadTools,
  registerMcpTools,
  type McpReadToolHandlers,
  type McpWriteToolHandlers,
} from "@/lib/mcp/server";
import { createMcpSupabaseClient } from "@/lib/mcp/supabase-user-client";
import { createWebMcpHandler } from "@/lib/mcp/web-transport-handler";
import { createMcpWriteToolHandlers } from "@/lib/mcp/write-tool-handlers";
import { createAuditedMcpWriteHandlers } from "@/lib/mcp/audited-write-handlers";

type RequestHandler = (request: Request) => Response | Promise<Response>;
type TokenVerifier = (
  request: Request,
  bearerToken?: string,
) => AuthInfo | undefined | Promise<AuthInfo | undefined>;

type TransportOptions = {
  basePath: string;
  maxDuration: number;
  verboseLogs: boolean;
  resourceUrl: string;
};

type AuthOptions = {
  required: boolean;
  requiredScopes: string[];
  resourceMetadataPath: string;
  resourceUrl: string;
};

export type McpRouteRuntimeDependencies = {
  createReadHandlers: (config: McpRuntimeConfig) => McpReadToolHandlers;
  createWriteHandlers?: (config: McpRuntimeConfig) => McpWriteToolHandlers;
  registerReadTools: (
    server: McpServer,
    handlers: McpReadToolHandlers,
  ) => void;
  registerTools?: (
    server: McpServer,
    readHandlers: McpReadToolHandlers,
    writeHandlers?: McpWriteToolHandlers,
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
    consumeRateLimit: consumeMcpRateLimit,
    writeAudit: writeMcpAuditEvent,
    nowMs: () => performance.now(),
    createRequestId: randomUUID,
  });
}

function createWriteHandlers(config: McpRuntimeConfig): McpWriteToolHandlers {
  const createUserClient = (accessToken: string) =>
    createMcpSupabaseClient(accessToken, {
      supabaseUrl: config.supabaseUrl,
      publishableKey: config.publishableKey,
    });
  const baseHandlers = createMcpWriteToolHandlers({ createUserClient }, config.writesEnabled);
  return createAuditedMcpWriteHandlers(baseHandlers, {
    createUserClient,
    consumeRateLimit: consumeMcpRateLimit,
    writeAudit: writeMcpAuditEvent,
    nowMs: () => performance.now(),
    createRequestId: randomUUID,
  });
}

const DEFAULT_DEPENDENCIES: McpRouteRuntimeDependencies = {
  createReadHandlers,
  createWriteHandlers,
  registerReadTools: registerMcpReadTools,
  registerTools: registerMcpTools,
  createTransportHandler: createWebMcpHandler,
  createTokenVerifier: createMcpHandlerTokenVerifier,
  wrapAuth: withEgaMcpAuth,
};

const PREFLIGHT_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Mcp-Method, Mcp-Name, Mcp-Param-*",
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
  const writeHandlers = config.writesEnabled && dependencies.createWriteHandlers
    ? dependencies.createWriteHandlers(config)
    : undefined;
  const register = dependencies.registerTools
    ? (server: McpServer) => dependencies.registerTools!(server, readHandlers, writeHandlers)
    : (server: McpServer) => dependencies.registerReadTools(server, readHandlers);
  const transportHandler = dependencies.createTransportHandler(
    register,
    {},
    {
      basePath: "/api",
      maxDuration: 60,
      verboseLogs: false,
      resourceUrl: config.resource,
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
