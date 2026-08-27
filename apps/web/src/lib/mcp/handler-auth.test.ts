import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  verifyMcpHandlerToken,
  type McpHandlerAuthDependencies,
} from "@/lib/mcp/handler-auth";
import { MCP_AUTHORIZED_SCOPE } from "@/lib/mcp/auth-info";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";

const ISSUER = "https://example.supabase.co/auth/v1";
const AUDIENCE = "https://ega.example.com/api/mcp";
const USER_ID = "00000000-0000-0000-0000-000000000001";
const CLIENT_ID = "test-mcp-client";
const EXPIRY = 2_000_000_100;

function createDependencies(
  grant: Awaited<ReturnType<McpHandlerAuthDependencies["loadGrant"]>>,
): McpHandlerAuthDependencies {
  return {
    issuer: ISSUER,
    audience: AUDIENCE,
    nowSeconds: 2_000_000_000,
    verifyAccessToken: vi.fn().mockResolvedValue({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: USER_ID,
      client_id: CLIENT_ID,
      exp: EXPIRY,
    }),
    createUserClient: vi
      .fn()
      .mockReturnValue({ marker: "user-client" } as unknown as SupabaseClient<McpDatabase>),
    loadGrant: vi.fn().mockResolvedValue(grant),
  };
}

describe("verifyMcpHandlerToken", () => {
  it("returns undefined for a missing bearer token", async () => {
    const dependencies = createDependencies(null);

    await expect(
      verifyMcpHandlerToken(undefined, dependencies),
    ).resolves.toBeUndefined();
    expect(dependencies.verifyAccessToken).not.toHaveBeenCalled();
  });

  it("returns authorized AuthInfo for an active resource-bound grant", async () => {
    const dependencies = createDependencies({
      id: "10000000-0000-0000-0000-000000000001",
      ownerUserId: USER_ID,
      oauthClientId: CLIENT_ID,
      resourceUri: AUDIENCE,
      status: "active",
      permissionProfile: "read_only",
      permissions: ["projects.read", "goals.read", "tasks.read"],
      permissionsVersion: 1,
    });

    await expect(
      verifyMcpHandlerToken("signed-token", dependencies),
    ).resolves.toEqual(
      expect.objectContaining({
        token: "signed-token",
        clientId: CLIENT_ID,
        scopes: [
          MCP_AUTHORIZED_SCOPE,
          "projects.read",
          "goals.read",
          "tasks.read",
        ],
        expiresAt: EXPIRY,
      }),
    );
    expect(dependencies.loadGrant).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      CLIENT_ID,
      AUDIENCE,
    );
  });

  it("returns verified but unauthorized AuthInfo when no active grant exists", async () => {
    const dependencies = createDependencies(null);

    await expect(
      verifyMcpHandlerToken("signed-token", dependencies),
    ).resolves.toEqual({
      token: "signed-token",
      clientId: CLIENT_ID,
      scopes: [],
      expiresAt: EXPIRY,
      extra: { ownerUserId: USER_ID },
    });
  });

  it("rejects a token issued for another audience", async () => {
    const dependencies = createDependencies(null);
    vi.mocked(dependencies.verifyAccessToken).mockResolvedValue({
      iss: ISSUER,
      aud: "authenticated",
      sub: USER_ID,
      client_id: CLIENT_ID,
      exp: EXPIRY,
    });

    await expect(
      verifyMcpHandlerToken("signed-token", dependencies),
    ).rejects.toEqual(
      expect.objectContaining({ code: "UNAUTHENTICATED", status: 401 }),
    );
    expect(dependencies.loadGrant).not.toHaveBeenCalled();
  });
});
