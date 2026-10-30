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
  registerMcpToolsForPrincipal,
  type McpReadToolHandlers,
  type McpWriteToolHandlers,
} from "@/lib/mcp/server";
import { filterToolsByPermissions } from "@/lib/mcp/tool-discovery";
import { readPrincipalFromAuthInfo } from "@/lib/mcp/auth-info";
import { isValidMcpPrincipal } from "@/lib/mcp/principal";
import { createMcpSupabaseClient } from "@/lib/mcp/supabase-user-client";
import {
  createMcpPreflightResponse,
  createWebMcpHandler,
  mcpOriginPolicy,
} from "@/lib/mcp/web-transport-handler";
import { createMcpWriteToolHandlers } from "@/lib/mcp/write-tool-handlers";
import { createAuditedMcpWriteHandlers } from "@/lib/mcp/audited-write-handlers";

type RequestHandler = (request: Request) => Response | Promise<Response>;
type TokenVerifier = (
  request: Request,
  bearerToken?: string,
) => AuthInfo | undefined | Promise<AuthInfo | undefined>;

// One option, because that is all the transport reads. `basePath`,
// `maxDuration` and `verboseLogs` used to be declared here, passed here, and
// read by nothing: the URL is routed by Next.js, the request budget belongs to
// the route module's `export const maxDuration`, and no transport code logs.
//
// The seam also used to carry a `serverOptions: Record<string, never>` slot that
// every caller filled with `{}` and that the transport ignored (it was declared
// `_serverOptions` at the implementation). A parameter typed to accept nothing
// and passed an empty object at every call site is the clearest possible
// "configuration" with no reader, so it is gone too.
type TransportOptions = {
  resourceUrl: string;
};

type AuthOptions = {
  requiredScopes: string[];
  resourceMetadataPath: string;
  resourceUrl: string;
};

export type McpRouteRuntimeDependencies = {
  createReadHandlers: (config: McpRuntimeConfig) => McpReadToolHandlers;
  createWriteHandlers?: (config: McpRuntimeConfig) => McpWriteToolHandlers;
  /** @deprecated Compatibility-only; never used as a registration fallback. */
  registerReadTools?: (
    server: McpServer,
    handlers: McpReadToolHandlers,
  ) => void;
  registerToolsForPrincipal?: (
    server: McpServer,
    readHandlers: McpReadToolHandlers,
    writeHandlers: McpWriteToolHandlers | undefined,
    allowedNames: ReadonlySet<string>,
  ) => void;
  createTransportHandler: (
    registerServer: (server: McpServer, authInfo?: AuthInfo) => void,
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
  const baseHandlers = createMcpWriteToolHandlers({ createUserClient }, config.writesEnabled, config.resource);
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
  registerToolsForPrincipal: registerMcpToolsForPrincipal,
  createTransportHandler: createWebMcpHandler,
  createTokenVerifier: createMcpHandlerTokenVerifier,
  wrapAuth: withEgaMcpAuth,
};

export type McpRouteRuntime = {
  GET: RequestHandler;
  POST: RequestHandler;
  OPTIONS: RequestHandler;
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
    if (!authInfo) return;
    try {
      const principal = readPrincipalFromAuthInfo(authInfo);
      if (!isValidMcpPrincipal(principal)) return;
      // Permission-aware discovery: only tools whose required permission the
      // principal holds (and the global kill switch permits) are advertised.
      const allowed = new Set(filterToolsByPermissions(principal.permissions, config.writesEnabled));
      if (!dependencies.registerToolsForPrincipal) return;
      dependencies.registerToolsForPrincipal(server, readHandlers, writeHandlers, allowed);
    } catch { /* Fail closed: an invalid principal receives no registered tools. */ }
  };
  // One derivation of the Host/Origin policy, from the same `config.resource`
  // both the transport and the preflight below are built from. It used to be
  // parsed twice - once inside the transport, once here - so the two could only
  // agree by coincidence of two matching literals.
  const originPolicy = mcpOriginPolicy(config.resource);
  const transportHandler = dependencies.createTransportHandler(
    register,
    { resourceUrl: config.resource },
  );
  const verifyToken = dependencies.createTokenVerifier(config);
  const authenticatedHandler = dependencies.wrapAuth(
    transportHandler,
    verifyToken,
    {
      requiredScopes: [MCP_AUTHORIZED_SCOPE],
      resourceMetadataPath: "/.well-known/oauth-protected-resource",
      resourceUrl: originPolicy.expectedOrigin,
    },
  );

  return {
    GET: authenticatedHandler,
    POST: authenticatedHandler,
    // Preflight runs through the SAME Host/Origin policy as the authenticated
    // POST path rather than a hardcoded wildcard. It used to answer with
    // `Access-Control-Allow-Origin: *` while POST rejected every origin but
    // the resource origin, and it skipped Host/Origin/size validation entirely.
    //
    // It also runs OUTSIDE `wrapAuth`, deliberately: a browser preflight carries
    // no Authorization header, so routing it through the auth wrapper would
    // answer every preflight with 401 and no allow-origin header. The cost is
    // that an unauthenticated request is answered 401 before Host/Origin is
    // examined; that ordering is asserted in route-runtime.test.ts rather than
    // left implicit.
    OPTIONS: (request) =>
      Promise.resolve(createMcpPreflightResponse(request, originPolicy)),
  };
}
