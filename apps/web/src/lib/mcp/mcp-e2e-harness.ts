import { randomUUID } from "node:crypto";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createAuditedMcpReadHandlers } from "@/lib/mcp/audited-read-handlers";
import type { AuditedReadHandlerDependencies } from "@/lib/mcp/audited-read-handlers";
import { createAuditedMcpWriteHandlers } from "@/lib/mcp/audited-write-handlers";
import { authInfoForToken, createFakeSupabaseClient, createMcpE2eStore, setCurrentE2eStore, type McpE2eStore } from "@/lib/mcp/mcp-e2e-mocks";
import type { McpRuntimeConfig } from "@/lib/mcp/config";
import { getMcpRuntimeConfig } from "@/lib/mcp/config";
import { withEgaMcpAuth } from "@/lib/mcp/http-auth";
import { listMcpGoals, listMcpProjects, listMcpTasks } from "@/lib/mcp/read-repository";
import { createMcpReadToolHandlers } from "@/lib/mcp/read-tool-handlers";
import {
  createMcpRouteRuntime,
  type McpRouteRuntime,
  type McpRouteRuntimeDependencies,
} from "@/lib/mcp/route-runtime";
import { registerMcpReadTools, registerMcpToolsForPrincipal } from "@/lib/mcp/server";
import { createWebMcpHandler } from "@/lib/mcp/web-transport-handler";
import { createMcpWriteToolHandlers } from "@/lib/mcp/write-tool-handlers";

/**
 * REAL-client E2E harness for the production MCP route.
 *
 * What is REAL here (nothing below is mocked):
 * - the production `createMcpRouteRuntime` composition: `withEgaMcpAuth` auth
 *   wrapper → `createWebMcpHandler` → SDK `createMcpHandler` → `registerMcpTools`
 *   registry → audited read/write handler wrappers → tool handlers;
 * - the real MCP v2 SDK `Client` speaking over a real
 *   `StreamableHTTPClientTransport` (POST JSON / SSE semantics, modern-era
 *   `server/discover` negotiation, MRTR input_required round trip).
 *
 * What is FAKED at the test boundary (see mcp-e2e-mocks.ts):
 * - `createTokenVerifier`: bearer tokens map directly to `McpPrincipal`s
 *   instead of Supabase token verification + grant lookup. This is the
 *   repository-sanctioned test auth boundary: identity still flows only from
 *   the verified bearer token, never from request fields.
 * - `createUserClient`: the in-memory store fake backs `.from()`/`.rpc()`.
 *   RLS (projects/goals/tasks) and the fenced `mcp_mutation_receipts`
 *   lease/token fencing are **not** enforced here; they are proved against a
 *   real Postgres by `scripts/db/mcp-receipt-invariant-verify.mjs`
 *   (CLAIM_GRANTED/IN_PROGRESS/REPLAY/CONFLICT + 2/10-way concurrency +
 *   read_only/cross-owner/revoked/wrong-client/resource + receipt RLS).
 *   The in-memory ledger is intentionally simplified (no lease expiry,
 *   no `FAILED_FINAL` reset, single-process advisory lock).
 * - `consumeRateLimit` (always allowed); audit writes use the fake Supabase
 *   client's claim-bound RPC path and are recorded in `store.auditEvents`.
 * - `@ega/application` / `@ega/data-access` are vi.mock-ed in the test file
 *   via the leaf factories in mcp-e2e-mocks.ts.
 */

export const E2E_MCP_URL = "https://ega.example.com/mcp";

export { OWNER_USER_IDS } from "@/lib/mcp/mcp-e2e-mocks";
export { setCurrentE2eStore, createMcpE2eRuntime };
export type { McpE2eStore };

// ---------------------------------------------------------------------------
// Production route runtime with fakes injected only at the persistence edge
// ---------------------------------------------------------------------------

export type McpE2eRuntime = {
  runtime: McpRouteRuntime;
  config: McpRuntimeConfig;
  store: McpE2eStore;
};

function createMcpE2eRuntime(): McpE2eRuntime {
  const store = createMcpE2eStore();
  setCurrentE2eStore(store);

  const config = getMcpRuntimeConfig({
    MCP_ENABLED: "true",
    MCP_WRITES_ENABLED: "true",
    MCP_RESOURCE_URL: E2E_MCP_URL,
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_ci_placeholder",
  });

  const createUserClient = (accessToken: string) => createFakeSupabaseClient(store, accessToken);

  const auditedDeps: AuditedReadHandlerDependencies = {
    createUserClient,
    consumeRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    writeAudit: async (client, input) => {
      await client.rpc("record_mcp_audit_event", {
        p_request_id: input.requestId,
        p_tool_name: input.toolName,
        p_outcome: input.outcome,
        p_duration_ms: input.durationMs,
        p_error_code: input.errorCode ?? null,
        p_metadata: input.metadata ?? {},
      });
    },
    nowMs: () => performance.now(),
    createRequestId: randomUUID,
  };

  const dependencies: McpRouteRuntimeDependencies = {
    // REAL read/write handler factories; only the persistence edge is faked.
    createReadHandlers: (runtimeConfig) =>
      createAuditedMcpReadHandlers(
        createMcpReadToolHandlers(
          {
            createUserClient,
            listProjects: listMcpProjects,
            listGoals: listMcpGoals,
            listTasks: listMcpTasks,
          },
          runtimeConfig.writesEnabled,
        ),
        auditedDeps,
      ),
    createWriteHandlers: (runtimeConfig) =>
      createAuditedMcpWriteHandlers(
        createMcpWriteToolHandlers({ createUserClient }, runtimeConfig.writesEnabled, runtimeConfig.resource),
        auditedDeps,
      ),
    registerReadTools: registerMcpReadTools,
    registerToolsForPrincipal: registerMcpToolsForPrincipal,
    // REAL transport (createWebMcpHandler → SDK createMcpHandler).
    createTransportHandler: createWebMcpHandler,
    // TEST-BOUNDARY AUTH FAKE: bearer token → McpPrincipal map instead of the
    // Supabase verifier. Identity is still derived ONLY from the bearer token.
    createTokenVerifier: () => async (_request: Request, bearerToken?: string) =>
      bearerToken ? authInfoForToken(bearerToken) : undefined,
    // REAL auth wrapper (withEgaMcpAuth) including scope checks and 401/403.
    wrapAuth: withEgaMcpAuth,
  };

  const runtime = createMcpRouteRuntime(config, dependencies);
  return { runtime, config, store };
}

// ---------------------------------------------------------------------------
// Real MCP v2 SDK client over the production route
// ---------------------------------------------------------------------------

export type E2eElicitationLog = {
  requests: Array<{ message?: string; requestedSchema?: unknown }>;
};

export type EgaMcpClient = {
  client: Client;
  transport: StreamableHTTPClientTransport;
  elicitationLog: E2eElicitationLog;
};

type EgaMcpClientOptions = {
  elicitationAction?: "accept" | "decline";
  elicitationContent?: EgaElicitationContent;
  protocolMode?: "legacy" | "auto" | { pin: "2026-07-28" };
};

export type EgaElicitationContent = {
  [key: string]: string | number | boolean | string[];
};

export function createEgaMcpClient(
  routeRuntime: McpRouteRuntime,
  bearerToken: string,
  options?: EgaMcpClientOptions,
): EgaMcpClient {
  const elicitationLog: E2eElicitationLog = { requests: [] };
  const client = new Client(
    { name: "ega-e2e", version: "1.0.0" },
    {
      capabilities: { elicitation: {} },
      versionNegotiation: { mode: options?.protocolMode ?? { pin: "2026-07-28" } },
      inputRequired: { autoFulfill: true, maxRounds: 3 },
    },
  );

  client.setRequestHandler("elicitation/create", async (request) => {
    const params = (request as unknown as { params?: { message?: string; requestedSchema?: unknown } })
      .params;
    elicitationLog.requests.push({
      message: params?.message,
      requestedSchema: params?.requestedSchema,
    });
    const action = options?.elicitationAction ?? "accept";
    if (action === "accept") {
      return { action: "accept", content: options?.elicitationContent ?? { confirm: true } };
    }
    return { action };
  });

  const transport = new StreamableHTTPClientTransport(new URL(E2E_MCP_URL), {
    // REAL HTTP bridge: the SDK transport performs its own HTTP semantics
    // (POST JSON, Accept headers, SSE parsing, protocol headers) against the
    // production route runtime. Only the network socket is elided — the
    // handler is the exact production composition.
    fetch: async (url, init) => {
      const request = new Request(url, init);
      request.headers.set("authorization", `Bearer ${bearerToken}`);
      request.headers.set("host", new URL(url).host);
      return routeRuntime.POST(request);
    },
    reconnectionOptions: {
      maxReconnectionDelay: 10,
      initialReconnectionDelay: 1,
      reconnectionDelayGrowFactor: 1,
      maxRetries: 0,
    },
  });

  return { client, transport, elicitationLog };
}

export async function connectEgaMcpClient(
  routeRuntime: McpRouteRuntime,
  bearerToken: string,
  options?: EgaMcpClientOptions,
): Promise<EgaMcpClient & { close: () => Promise<void> }> {
  const { client, transport, elicitationLog } = createEgaMcpClient(routeRuntime, bearerToken, options);
  await client.connect(transport);
  return {
    client,
    transport,
    elicitationLog,
    close: () => client.close(),
  };
}

// Re-exported for convenience; the vi.mock factories in the test file import
// the leaf module "@/lib/mcp/mcp-e2e-mocks" DIRECTLY to avoid re-entering the
// production module graph (which would deadlock ESM evaluation).
export {
  buildApplicationModuleMock,
  FakeSupabaseGoalsRepository,
  FakeSupabaseProjectsRepository,
  FakeSupabaseTasksRepository,
  FakeSupabaseTodayReadPort,
  FakeSupabaseTimerSessionRepository,
} from "@/lib/mcp/mcp-e2e-mocks";
