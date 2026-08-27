import type { AuthInfo } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

import {
  getMcpRequestAuthInfo,
  withEgaMcpAuth,
} from "@/lib/mcp/http-auth";

const OPTIONS = {
  required: true,
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
});
