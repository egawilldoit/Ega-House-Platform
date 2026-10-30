import type { AuthInfo } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

import {
  getMcpRequestAuthInfo,
  withEgaMcpAuth,
} from "@/lib/mcp/http-auth";

const OPTIONS = {
  requiredScopes: ["ega.mcp.authorized"],
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
  resourceUrl: "https://ega.example.com",
};

const AUTH_INFO: AuthInfo = {
  token: "signed-token",
  clientId: "hermes-client",
  scopes: ["ega.mcp.authorized", "projects.read"],
  expiresAt: 2_000_000_100,
};

describe("withEgaMcpAuth", () => {
  it("returns a standards-compatible 401 for missing bearer auth", async () => {
    const handler = vi.fn();
    const verify = vi.fn();
    const protectedHandler = withEgaMcpAuth(handler, verify, OPTIONS);

    const response = await protectedHandler(
      new Request("https://ega.example.com/api/mcp"),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://ega.example.com/.well-known/oauth-protected-resource"',
    );
    expect(handler).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it("returns 403 for a valid token without the active-grant marker", async () => {
    const handler = vi.fn();
    const verify = vi.fn().mockResolvedValue({ ...AUTH_INFO, scopes: [] });
    const protectedHandler = withEgaMcpAuth(handler, verify, OPTIONS);

    const response = await protectedHandler(
      new Request("https://ega.example.com/api/mcp", {
        headers: { Authorization: "Bearer signed-token" },
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain(
      'error="insufficient_scope"',
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes verified auth info to the request-scoped transport", async () => {
    const handler = vi.fn(async (request: Request) =>
      Response.json(getMcpRequestAuthInfo(request)),
    );
    const verify = vi.fn().mockResolvedValue(AUTH_INFO);
    const protectedHandler = withEgaMcpAuth(handler, verify, OPTIONS);

    const response = await protectedHandler(
      new Request("https://ega.example.com/api/mcp", {
        headers: { Authorization: "Bearer signed-token" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(AUTH_INFO);
    expect(verify).toHaveBeenCalledWith(expect.any(Request), "signed-token");
  });

  it("redacts verifier failures as invalid tokens", async () => {
    const handler = vi.fn();
    const verify = vi.fn().mockRejectedValue(new Error("database secret"));
    const protectedHandler = withEgaMcpAuth(handler, verify, OPTIONS);

    const response = await protectedHandler(
      new Request("https://ega.example.com/api/mcp", {
        headers: { Authorization: "Bearer signed-token" },
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_token",
      error_description: "Invalid access token.",
    });
  });

  it("fails closed when a verifier returns malformed auth info", async () => {
    const handler = vi.fn();
    const verify = vi.fn().mockResolvedValue({ scopes: ["ega.mcp.authorized"], expiresAt: Number.NaN });
    const protectedHandler = withEgaMcpAuth(handler, verify, OPTIONS);

    const response = await protectedHandler(new Request("https://ega.example.com/api/mcp", {
      headers: { Authorization: "Bearer signed-token", "Mcp-Method": "ega_create_project", "Mcp-Name": "ega_create_project" },
    }));

    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not treat MCP routing headers as authorization", async () => {
    const handler = vi.fn();
    const verify = vi.fn();
    const protectedHandler = withEgaMcpAuth(handler, verify, OPTIONS);

    const response = await protectedHandler(new Request("https://ega.example.com/api/mcp", {
      headers: { "Mcp-Method": "ega_create_project", "Mcp-Name": "ega_create_project" },
    }));

    expect(response.status).toBe(401);
    expect(verify).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  describe("the refusals are part of the same route-wide cache contract", () => {
    it.each([
      ["401", undefined, 401],
      ["403", { ...AUTH_INFO, scopes: [] }, 403],
    ])("marks the %s no-store and origin-dependent", async (_label, verified, status) => {
      // These are produced BEFORE Host/Origin is validated, because wrapAuth is
      // outside the transport. So they must never carry an allow-origin - that
      // would advertise the authenticated path to any origin. They must still be
      // no-store and Vary: Origin, because they are this route's responses and
      // are decided per origin.
      const handler = vi.fn();
      const verify = verified
        ? vi.fn().mockResolvedValue(verified)
        : vi.fn();
      const protectedHandler = withEgaMcpAuth(handler, verify, OPTIONS);
      const headers: Record<string, string> = {
        origin: "https://ega.example.com",
      };
      if (verified) headers.Authorization = "Bearer signed-token";

      const response = await protectedHandler(
        new Request("https://ega.example.com/api/mcp", { headers }),
      );

      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("vary")).toBe("Origin");
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    });
  });

  it("advertises a resource_metadata URL the deployment actually serves", async () => {
    // RFC 9728 puts the well-known segment before the resource path. A client
    // that cannot fetch the advertised document cannot discover the
    // authorization server, so a typo here is a silent client break rather than
    // an error. The assertion is on the exact URL, and the route exists at
    // apps/web/src/app/.well-known/oauth-protected-resource/route.ts (verified by
    // inspection of the app router tree).
    const handler = vi.fn();
    const verify = vi.fn();
    const protectedHandler = withEgaMcpAuth(handler, verify, OPTIONS);

    const response = await protectedHandler(
      new Request("https://ega.example.com/api/mcp"),
    );

    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://ega.example.com/.well-known/oauth-protected-resource"',
    );
  });

  it("accepts a lowercase `bearer` scheme, which RFC 7235 makes case-insensitive", async () => {
    // A client that lowercases its scheme header must not be told its token is
    // invalid. Removing this would be a real-client regression, so the tolerance
    // is pinned.
    const handler = vi.fn(async () => new Response("ok"));
    const verify = vi.fn().mockResolvedValue(AUTH_INFO);
    const protectedHandler = withEgaMcpAuth(handler, verify, OPTIONS);

    const response = await protectedHandler(
      new Request("https://ega.example.com/api/mcp", {
        headers: { Authorization: "bearer signed-token" },
      }),
    );

    expect(response.status).toBe(200);
    expect(verify).toHaveBeenCalledWith(expect.any(Request), "signed-token");
  });

  it.each([
    ["a non-Bearer scheme", "Basic dXNlcjpwYXNz"],
    ["a bearer with empty credentials", "Bearer "],
    ["extra credentials after the token", "Bearer a b"],
    ["a token containing whitespace", "Bearer signed token"],
  ])("refuses %s rather than forwarding it", async (_label, authorization) => {
    // The wrapper must not hand a malformed Authorization header to the handler,
    // and must not treat a scheme it does not understand as a valid token.
    const handler = vi.fn();
    const verify = vi.fn();
    const protectedHandler = withEgaMcpAuth(handler, verify, OPTIONS);

    const response = await protectedHandler(
      new Request("https://ega.example.com/api/mcp", { headers: { Authorization: authorization } }),
    );

    expect(response.status).toBe(401);
    expect(verify).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("attaches auth info as a non-enumerable, non-writable property", async () => {
    // The transport reads it through `getMcpRequestAuthInfo`. If it were
    // enumerable it would ride along in any JSON serialisation of the request,
    // and if it were writable a downstream handler could substitute its own
    // identity - which is the one thing this wrapper exists to prevent.
    const handler = vi.fn(async (request: Request) =>
      Response.json({
        enumerable: Object.keys(request).includes("auth"),
        writable: (() => {
          try {
            (request as { auth?: unknown }).auth = { token: "forged" };
            return true;
          } catch {
            return false;
          }
        })(),
        token: getMcpRequestAuthInfo(request)?.token,
      }),
    );
    const verify = vi.fn().mockResolvedValue(AUTH_INFO);
    const protectedHandler = withEgaMcpAuth(handler, verify, OPTIONS);

    const response = await protectedHandler(
      new Request("https://ega.example.com/api/mcp", {
        headers: { Authorization: "Bearer signed-token" },
      }),
    );

    await expect(response.json()).resolves.toEqual({
      enumerable: false,
      writable: false,
      token: "signed-token",
    });
  });
});
