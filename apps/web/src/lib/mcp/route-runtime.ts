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
import { filterToolsByPermissions } from "@/lib/mcp/tool-discovery";
import { readPrincipalFromAuthInfo } from "@/lib/mcp/auth-info";
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
    registerServer: (server: McpServer, authInfo?: AuthInfo) => void,
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
    "Authorization, Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
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
  const writeHandlers = dependencies.createWriteHandlers
    ? dependencies.createWriteHandlers(config)
    : undefined;
  const register = (server: McpServer, authInfo?: AuthInfo) => {
    if (!authInfo) {
      dependencies.registerReadTools(server, readHandlers);
      return;
    }
    try {
      const principal = readPrincipalFromAuthInfo(authInfo);
      const allowed = new Set(filterToolsByPermissions(principal.permissions, config.writesEnabled));
      // Only register tools that are allowed for this principal
      // We need to map tool names to handlers — for now we do per-tool registration
      // If no write allowed, only reads
        // Per-tool filtering: only register tools whose required permission is in allowed
      // Map tool names to required permissions (from tool-discovery.ts)
      const allowedWrites = [...allowed].filter((t) => !["ega_get_capabilities","ega_list_projects","ega_list_goals","ega_list_tasks","ega_get_today_plan","ega_list_timer_sessions"].includes(t));
      if (allowedWrites.length > 0 && writeHandlers && dependencies.registerTools) {
        // For now, still register all writes if any write allowed — next step is per-tool register
        // But we can at least ensure read_only (which has no writes) only gets reads
        dependencies.registerTools(server, readHandlers, writeHandlers);
      } else {
        dependencies.registerReadTools(server, readHandlers);
      }
    } catch {
      dependencies.registerReadTools(server, readHandlers);
    }
  };
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
