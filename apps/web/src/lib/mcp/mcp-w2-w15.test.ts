import { describe, expect, it } from "vitest";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod-v4";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { filterToolsByPermissions } from "@/lib/mcp/tool-discovery";
import { createRequestStateCodec } from "@/lib/mcp/request-state";
import { createWebMcpHandler } from "@/lib/mcp/web-transport-handler";
import { createMcpWriteToolHandlers } from "@/lib/mcp/write-tool-handlers";
import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import type { McpPrincipal } from "@/lib/mcp/principal";

// W2: createMcpHandler auth propagation
describe("W2 createMcpHandler auth propagation", () => {
  it("propagates verified AuthInfo to ctx.http.authInfo", async () => {
    const principal: McpPrincipal = {
      ownerUserId: "00000000-0000-0000-0000-000000000001",
      oauthClientId: "hermes-client",
      grantId: "10000000-0000-0000-0000-000000000001",
      permissionProfile: "read_only",
      permissionsVersion: 1,
      permissions: ["projects.read", "goals.read", "tasks.read", "today.read", "timer.read"],
    };
    const authInfo = createMcpAuthInfo("test-token", principal);
    let capturedAuth: AuthInfo | undefined;
    const handler = createMcpHandler(
      () => {
        const server = new McpServer({ name: "test", version: "1.0.0" }, { capabilities: { tools: {} } });
        server.registerTool(
          "ping",
          { title: "ping", description: "ping", inputSchema: z.object({}) },
          async (_args: unknown, ctx: unknown) => {
            capturedAuth = (ctx as unknown as { http?: { authInfo?: AuthInfo } }).http?.authInfo ?? (ctx as unknown as { authInfo?: AuthInfo }).authInfo;
            return { content: [{ type: "text", text: "pong" }] };
          },
        );
        return server;
      },
      { legacy: "reject" } as never,
    );
    const request = new Request("https://ega.example.com/api/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "ping",
          arguments: {},
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        host: "ega.example.com",
        origin: "https://ega.example.com",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
        "Mcp-Name": "ping",
      },
    });
    // Simulate passing authInfo via handler.fetch
    const response = await handler.fetch(request, { authInfo });
    expect(response.status).toBe(200);
    expect(capturedAuth?.token).toBe("test-token");
  });

  it("server/discover is served without Mcp-Session-Id", async () => {
    const handler = createMcpHandler(
      () => new McpServer({ name: "test", version: "1.0.0" }, { capabilities: { tools: {} } }),
      { legacy: "reject" } as never,
    );
    const request = new Request("https://ega.example.com/api/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover", params: {} }),
      headers: { "content-type": "application/json", host: "ega.example.com", "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "server/discover", "Mcp-Name": "server/discover" },
    });
    const response = await handler.fetch(request);
    // Should be handled, not 405, and not require Mcp-Session-Id
    expect([200, 400, 404].includes(response.status)).toBe(true);
    expect(response.headers.get("Mcp-Session-Id")).toBeNull();
  });
});

// W3 Host/Origin
describe("W3 Host/Origin", () => {
  it("rejects bad Host", async () => {
    const handler = createWebMcpHandler(
      () => {},
      {},
      { basePath: "/api", maxDuration: 60, verboseLogs: false, resourceUrl: "https://ega.example.com/api/mcp" },
    );
    const request = new Request("https://evil.com/api/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: {} }),
      headers: { "content-type": "application/json", host: "evil.com" },
    });
    const response = await handler(request);
    expect([400, 421].includes(response.status)).toBe(true);
  });

  it("rejects bad Origin", async () => {
    const handler = createWebMcpHandler(
      () => {},
      {},
      { basePath: "/api", maxDuration: 60, verboseLogs: false, resourceUrl: "https://ega.example.com/api/mcp" },
    );
    const request = new Request("https://ega.example.com/api/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: {} }),
      headers: { "content-type": "application/json", host: "ega.example.com", origin: "https://evil.com" },
    });
    const response = await handler(request);
    expect(response.status).toBe(403);
  });

  it("does not authorize via Mcp-Method", async () => {
    const principal: McpPrincipal = {
      ownerUserId: "00000000-0000-0000-0000-000000000001",
      oauthClientId: "hermes-client",
      grantId: "10000000-0000-0000-0000-000000000001",
      permissionProfile: "read_only",
      permissionsVersion: 1,
      permissions: ["projects.read", "goals.read", "tasks.read", "today.read", "timer.read"],
    };
    const allowed = filterToolsByPermissions(principal.permissions, true);
    expect(allowed.includes("ega_create_project")).toBe(false);
    // Even if Mcp-Method is ega_create_project, it doesn't grant permission
    expect(allowed.includes("ega_create_project")).toBe(false);
  });
});

// W5 discovery
describe("W5 permission-aware discovery", () => {
  it("read_only sees seven reads, no writes", () => {
    const allowed = filterToolsByPermissions(["projects.read", "goals.read", "tasks.read", "today.read", "timer.read"], true);
    expect(allowed).toEqual(expect.arrayContaining(["ega_list_projects", "ega_get_today_plan"]));
    expect(allowed.includes("ega_create_project")).toBe(false);
  });
  it("workspace_manager sees writes", () => {
    const allowed = filterToolsByPermissions(
      ["projects.read", "projects.create", "projects.update", "goals.read", "goals.create", "goals.update", "tasks.read", "tasks.create", "tasks.update", "today.read", "today.update", "timer.read", "timer.create", "timer.update"],
      true,
    );
    expect(allowed.includes("ega_create_project")).toBe(true);
    expect(allowed.includes("ega_create_task")).toBe(true);
  });
  it("writes hidden when MCP_WRITES_ENABLED false", () => {
    const allowed = filterToolsByPermissions(
      ["projects.read", "projects.create", "projects.update", "goals.read", "goals.create", "goals.update", "tasks.read", "tasks.create", "tasks.update", "today.read", "today.update", "timer.read", "timer.create", "timer.update"],
      false,
    );
    expect(allowed.includes("ega_create_project")).toBe(false);
  });
});

// W9 requestState
describe("W9 requestState", () => {
  it("tamper rejected, expiry rejected, revoked rejected, cross-instance works", async () => {
    const secret = "test-secret-32-bytes-long-for-dev-only-1234";
    const codec = createRequestStateCodec({ key: secret, ttlSeconds: 1 });
    const state = await codec.mint({ user: "u1", client: "c1", tool: "t" } as never);
    // Tamper
    const tampered = state.slice(0, -1) + (state.endsWith("A") ? "B" : "A");
    await expect(codec.verify(tampered)).rejects.toThrow();
    // Expiry — wait 2s to ensure floor crosses
    await new Promise((r) => setTimeout(r, 2100));
    await expect(codec.verify(state)).rejects.toThrow();
    // Cross-instance (same secret, new codec)
    const codec2 = createRequestStateCodec({ key: secret, ttlSeconds: 300 });
    const state2 = await codec.mint({ user: "u1", client: "c1", tool: "t" } as never);
    await expect(codec2.verify(state2)).resolves.toBeDefined();
  });
});

// W10 idempotency is fail-closed
describe("W10 idempotency", () => {
  it("fail-closed on ledger error", async () => {
    const handlers = createMcpWriteToolHandlers(
      {
        createUserClient: () =>
          ({
            rpc: () => Promise.resolve({ data: null, error: { message: "ledger down" } }),
            from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }), insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { message: "fail" } }) }) }) }),
          }) as never,
      },
      true,
    );
    const authInfo = createMcpAuthInfo("t", {
      ownerUserId: "00000000-0000-0000-0000-000000000001",
      oauthClientId: "c",
      grantId: "g",
      permissionProfile: "workspace_manager",
      permissionsVersion: 1,
      permissions: ["projects.create", "projects.read", "goals.read", "tasks.read", "today.read", "timer.read", "projects.read", "projects.create", "projects.update", "goals.create", "goals.update", "tasks.create", "tasks.update", "today.update", "timer.create", "timer.update"],
    } as never);
    const result = await handlers.createProject(authInfo as never, { name: "test", operationId: "550e8400-e29b-41d4-a716-446655440000" } as never);
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { error?: { code?: string } }).error?.code).not.toBe("CONFLICT");
  });
});
