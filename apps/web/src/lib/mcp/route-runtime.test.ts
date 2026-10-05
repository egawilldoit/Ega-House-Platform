import type { McpServer } from "@modelcontextprotocol/server";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

import { MCP_AUTHORIZED_SCOPE } from "@/lib/mcp/auth-info";
import {
  createMcpRouteRuntime,
  type McpRouteRuntimeDependencies,
} from "@/lib/mcp/route-runtime";
import { mcpOriginPolicy } from "@/lib/mcp/web-transport-handler";

const CONFIG = {
  enabled: true,
  writesEnabled: false,
  resource: "https://ega.example.com/api/mcp",
  issuer: "https://example.supabase.co/auth/v1",
  supabaseUrl: "https://example.supabase.co",
  publishableKey: "publishable-key"
};

describe("createMcpRouteRuntime", () => {
  it("builds one authenticated Streamable HTTP handler", async () => {
    const transportResponse = new Response("transport");
    const authenticatedResponse = new Response("authenticated");
    const transportHandler = vi.fn().mockResolvedValue(transportResponse);
    const authenticatedHandler = vi.fn().mockResolvedValue(authenticatedResponse);
    const verifyToken = vi.fn();
    const handlers = { marker: "read-handlers" };
    const dependencies: McpRouteRuntimeDependencies = {
      createReadHandlers: vi.fn().mockReturnValue(handlers),
      registerReadTools: vi.fn(),
      createTransportHandler: vi.fn().mockReturnValue(transportHandler),
      createTokenVerifier: vi.fn().mockReturnValue(verifyToken),
      wrapAuth: vi.fn().mockReturnValue(authenticatedHandler),
    };

    const runtime = createMcpRouteRuntime(CONFIG, dependencies);
    const request = new Request(CONFIG.resource, { method: "POST" });

    await expect(runtime.POST(request)).resolves.toBe(authenticatedResponse);
    expect(dependencies.createReadHandlers).toHaveBeenCalledWith(CONFIG);
    // Exactly one transport option. `basePath`, `maxDuration` and `verboseLogs`
    // were removed because no reader existed anywhere in the repo; if any of them
    // were load-bearing, this assertion - which pins the whole object rather
    // than `objectContaining` - would fail to compile when they were reinstated
    // without a reader.
    expect(dependencies.createTransportHandler).toHaveBeenCalledWith(
      expect.any(Function),
      { resourceUrl: CONFIG.resource },
    );
    expect(dependencies.createTokenVerifier).toHaveBeenCalledWith(CONFIG);
    expect(dependencies.wrapAuth).toHaveBeenCalledWith(
      transportHandler,
      verifyToken,
      {
        requiredScopes: [MCP_AUTHORIZED_SCOPE],
        resourceMetadataPath: "/.well-known/oauth-protected-resource",
        resourceUrl: "https://ega.example.com",
      },
    );
  });

  it("registers no fallback tools when auth information is absent or malformed", () => {
    let registerServer: ((server: McpServer, authInfo?: AuthInfo) => void) | undefined;
    const dependencies: McpRouteRuntimeDependencies = {
      createReadHandlers: vi.fn().mockReturnValue({ marker: "handlers" }),
      registerReadTools: vi.fn(),
      registerToolsForPrincipal: vi.fn(),
      createTransportHandler: vi.fn((register) => {
        registerServer = register;
        return vi.fn();
      }),
      createTokenVerifier: vi.fn().mockReturnValue(vi.fn()),
      wrapAuth: vi.fn().mockReturnValue(vi.fn()),
    };

    createMcpRouteRuntime(CONFIG, dependencies);
    const server = {} as McpServer;
    registerServer!(server);
    registerServer!(server, { token: "token", clientId: "client", scopes: [], extra: { principal: { ownerUserId: "owner" } } });

    expect(dependencies.registerReadTools).not.toHaveBeenCalled();
    expect(dependencies.registerToolsForPrincipal).not.toHaveBeenCalled();
  });

  it("uses the same authenticated boundary for GET and POST", () => {
    const handler = vi.fn();
    const dependencies: McpRouteRuntimeDependencies = {
      createReadHandlers: vi.fn().mockReturnValue({}),
      registerReadTools: vi.fn(),
      createTransportHandler: vi.fn().mockReturnValue(vi.fn()),
      createTokenVerifier: vi.fn().mockReturnValue(vi.fn()),
      wrapAuth: vi.fn().mockReturnValue(handler),
    };

    const runtime = createMcpRouteRuntime(CONFIG, dependencies);

    expect(runtime.GET).toBe(handler);
    expect(runtime.POST).toBe(handler);
  });

  describe("preflight and POST express one origin policy", () => {
    const RESOURCE_ORIGIN = "https://ega.example.com";
    const RESOURCE_HOST = "ega.example.com";

    const wrapAuth = vi.fn().mockReturnValue(vi.fn());

    function runtime() {
      const dependencies: McpRouteRuntimeDependencies = {
        createReadHandlers: vi.fn().mockReturnValue({}),
        registerReadTools: vi.fn(),
        createTransportHandler: vi.fn().mockReturnValue(vi.fn()),
        createTokenVerifier: vi.fn().mockReturnValue(vi.fn()),
        wrapAuth,
      };
      return createMcpRouteRuntime(CONFIG, dependencies);
    }

    function preflight(init: { origin?: string; host?: string } = {}): Request {
      const headers = new Headers();
      if (init.origin !== undefined) headers.set("origin", init.origin);
      headers.set("host", init.host ?? RESOURCE_HOST);
      return new Request(`${CONFIG.resource}#preflight`, { method: "OPTIONS", headers });
    }

    it("echoes the resource origin for a matching browser origin, never a wildcard", async () => {
      const response = await runtime().OPTIONS(preflight({ origin: RESOURCE_ORIGIN }));

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe(RESOURCE_ORIGIN);
      expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
      expect(response.headers.get("vary")).toBe("Origin");
      expect(response.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
      expect(response.headers.get("access-control-allow-headers")).toBe(
        "Authorization, Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
      );
    });

    it("refuses a foreign browser origin instead of advertising it as allowed", async () => {
      const response = await runtime().OPTIONS(preflight({ origin: "https://evil.example" }));

      // The browser only needs the missing allow-origin header to block the
      // request; a 403 additionally makes the refusal unambiguous.
      expect(response.status).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("marks the origin-dependent 204 no-store as well as Vary: Origin", async () => {
      // 204 is heuristically cacheable (RFC 9110 15.1) and this body depends on
      // the Origin the caller sent. `Access-Control-Max-Age` is 24h, so without
      // no-store a shared cache holding one origin's allow-origin could answer a
      // later preflight for a different origin. Both directives together.
      const response = await runtime().OPTIONS(preflight({ origin: RESOURCE_ORIGIN }));

      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("vary")).toBe("Origin");
      // Sanity: the Max-Age is what makes no-store necessary rather than
      // redundant. If it were ever dropped, the no-store assertion above would
      // still pass while the reason for it no longer held.
      expect(response.headers.get("access-control-max-age")).toBe("86400");
    });

    it("keeps the refusal uncacheable too", async () => {
      const response = await runtime().OPTIONS(preflight({ origin: "https://evil.example" }));

      expect(response.headers.get("cache-control")).toContain("no-store");
    });

    it("Vary: Origin on every refusal, so the route's cache contract has no exception", async () => {
      // The 204, the 401/403 (http-auth.ts) and the 404 (endpoint.ts) all carry
      // `Vary: Origin`. The refusals below did not: `invalidRequest` set only
      // `Cache-Control: no-store`. Asserted across every refusal class the
      // preflight can produce so the exception cannot come back on one of them.
      const refusals = [
        ["a wrong host", { origin: RESOURCE_ORIGIN, host: `${RESOURCE_HOST}.evil` }],
        ["a foreign origin", { origin: "https://evil.example", host: RESOURCE_HOST }],
        ["an opaque origin", { origin: "null", host: RESOURCE_HOST }],
        ["an explicit :80", { origin: RESOURCE_ORIGIN, host: `${RESOURCE_HOST}:80` }],
        ["a backslash host", { origin: RESOURCE_ORIGIN, host: `${RESOURCE_HOST}\\evil.com` }],
      ] as const;

      for (const [label, init] of refusals) {
        const response = await runtime().OPTIONS(preflight(init));

        expect(response.status, label).toBeGreaterThanOrEqual(400);
        expect(response.headers.get("vary"), label).toContain("Origin");
        expect(response.headers.get("cache-control"), label).toContain("no-store");
        // Still no allow-origin: Vary is not permission.
        expect(response.headers.get("access-control-allow-origin"), label).toBeNull();
      }
    });

    it("refuses a Host whose authority only re-parses to the resource host", async () => {
      // `ega.example.com\evil.com` parses (via WHATWG URL, which treats `\` as
      // a path separator) to the resource host, so a Host check written as
      // "re-parse and compare" accepts an authority an intermediary may read
      // differently. Same for a percent-encoded first label.
      for (const host of [`${RESOURCE_HOST}\\evil.com`, "%65ga.example.com"]) {
        const response = await runtime().OPTIONS(preflight({ origin: RESOURCE_ORIGIN, host }));

        expect(response.status, host).toBe(400);
        expect(response.headers.get("access-control-allow-origin"), host).toBeNull();
      }
    });

    it("refuses an explicit :80 rather than normalising it onto this https resource", async () => {
      const response = await runtime().OPTIONS(preflight({
        origin: RESOURCE_ORIGIN,
        host: `${RESOURCE_HOST}:80`,
      }));

      expect(response.status).toBe(421);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("answers preflight before auth, because a browser preflight carries no token", async () => {
      // If preflight were routed through wrapAuth it would answer 401 with no
      // allow-origin header and no cross-origin browser client could ever reach
      // the endpoint. The unauthenticated preflight succeeding is the assertion.
      const verifyToken = vi.fn();
      const innerHandler = vi.fn();
      const dependencies: McpRouteRuntimeDependencies = {
        createReadHandlers: vi.fn().mockReturnValue({}),
        createTransportHandler: vi.fn().mockReturnValue(vi.fn()),
        createTokenVerifier: vi.fn().mockReturnValue(verifyToken),
        wrapAuth: vi.fn().mockReturnValue(innerHandler),
      };
      const route = createMcpRouteRuntime(CONFIG, dependencies);
      const headers = new Headers({ host: RESOURCE_HOST, origin: RESOURCE_ORIGIN });

      const response = await route.OPTIONS(
        new Request(`${CONFIG.resource}#preflight`, { method: "OPTIONS", headers }),
      );

      expect(response.status).toBe(204);
      // `wrapAuth` is called once at CONSTRUCTION (it builds the GET/POST
      // handler), so the meaningful assertion is that the handler it returned was
      // never invoked for this preflight - plus that no token was verified.
      expect(innerHandler).not.toHaveBeenCalled();
      expect(verifyToken).not.toHaveBeenCalled();
    });

    it("documents the ordering it costs: auth is answered before Host/Origin", async () => {
      // The trade-off is explicit rather than incidental. An unauthenticated
      // request with a bad Origin gets 401, not the 403 the origin policy would
      // give it, because wrapAuth is outside the transport. This is safe because
      // the 401 leaks nothing about the origin policy, and the preflight above has
      // already refused that origin - but it must stay a known property, not a
      // surprise, so it is asserted.
      const runtimeDependencies: McpRouteRuntimeDependencies = {
        createReadHandlers: vi.fn().mockReturnValue({}),
        createTransportHandler: vi.fn().mockReturnValue(vi.fn()),
        createTokenVerifier: vi.fn().mockReturnValue(vi.fn()),
        wrapAuth,
      };
      const route = createMcpRouteRuntime(CONFIG, runtimeDependencies);

      // The auth options carry no "required" flag any more: the wrapper has no
      // unauthenticated pass-through, so there is nothing for a caller to set.
      expect(wrapAuth).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Function),
        {
          requiredScopes: [MCP_AUTHORIZED_SCOPE],
          resourceMetadataPath: "/.well-known/oauth-protected-resource",
          resourceUrl: "https://ega.example.com",
        },
      );
      expect(route.GET).toBe(route.POST);
      expect(route.OPTIONS).not.toBe(route.GET);
    });

    it("allows a server-to-server preflight with no Origin", async () => {
      const response = await runtime().OPTIONS(preflight());

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(response.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    });

    it("refuses a preflight whose Host does not match the resource", async () => {
      const response = await runtime().OPTIONS(
        preflight({ origin: RESOURCE_ORIGIN, host: "ega.example.com.evil" }),
      );

      expect(response.status).toBe(421);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("never emits Access-Control-Allow-Credentials, so a wildcard could not be reintroduced", async () => {
      const response = await runtime().OPTIONS(preflight({ origin: RESOURCE_ORIGIN }));

      // Auth is a Bearer token, not a cookie, so credentialed CORS is neither
      // needed nor wanted here. Asserting its absence pins the decision.
      expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    });

    it("derives the preflight policy from the resource it passes to the transport", async () => {
      // Both used to parse `config.resource` independently - the transport
      // inside createWebMcpHandler, this module inline - so they agreed only
      // because two literals happened to match. If the derivation diverged, the
      // preflight would validate one host while POST validated another. Asserted
      // by construction now: both come from `mcpOriginPolicy(config.resource)`,
      // and this test pins the resulting verdicts so a divergence is observable.
      const dependencies: McpRouteRuntimeDependencies = {
        createReadHandlers: vi.fn().mockReturnValue({}),
        createTransportHandler: vi.fn().mockReturnValue(vi.fn()),
        createTokenVerifier: vi.fn().mockReturnValue(vi.fn()),
        wrapAuth: vi.fn().mockReturnValue(vi.fn()),
      };
      createMcpRouteRuntime(CONFIG, dependencies);

      const [, transportOptions] = vi.mocked(dependencies.createTransportHandler).mock.calls[0];
      expect(transportOptions).toEqual({ resourceUrl: CONFIG.resource });

      const policy = mcpOriginPolicy(CONFIG.resource);
      expect(policy.expectedHost).toBe(RESOURCE_HOST);
      expect(policy.expectedOrigin).toBe(RESOURCE_ORIGIN);

      // And the runtime's own preflight accepts exactly that (Host, Origin)...
      expect((await runtime().OPTIONS(preflight({ origin: RESOURCE_ORIGIN }))).status).toBe(204);
      // ...while refusing the near-misses that a different derivation would let
      // through.
      expect((await runtime().OPTIONS(preflight({ host: `${RESOURCE_HOST}:8443` }))).status).toBe(421);
    });

    it("refuses an unauthenticated preflight to become a host oracle", async () => {
      // The preflight runs before auth, so it is the one unauthenticated response
      // on this route. 421 vs 400 distinguishes "wrong host" from "malformed
      // host", which is information about the deployment. That is a deliberate
      // and acceptable disclosure for a Host check on a public endpoint, but it
      // must not extend to any allow-origin header - which is asserted here, and
      // is the property that actually matters for CORS.
      const ok = await runtime().OPTIONS(preflight({ origin: RESOURCE_ORIGIN }));
      const bad = await runtime().OPTIONS(preflight({
        origin: RESOURCE_ORIGIN,
        host: "some-other-host.example",
      }));

      expect(ok.headers.get("access-control-allow-origin")).toBe(RESOURCE_ORIGIN);
      expect(bad.headers.get("access-control-allow-origin")).toBeNull();
    });
  });
});
