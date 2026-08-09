import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { createAuthenticatedMcpContext } from "@/lib/mcp/context";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";

const ISSUER = "https://example.supabase.co/auth/v1";
const AUDIENCE = "https://ega.example.com/api/mcp";
const USER_ID = "00000000-0000-0000-0000-000000000001";
const CLIENT_ID = "hermes-client";

function bearerHeaders(): Headers {
  return new Headers({ authorization: "Bearer signed-token" });
}

describe("createAuthenticatedMcpContext", () => {
  it("assembles a request-scoped client and resolved principal", async () => {
    const client = { marker: "user-client" } as unknown as SupabaseClient<McpDatabase>;
    const verifyAccessToken = vi.fn().mockResolvedValue({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: USER_ID,
      client_id: CLIENT_ID,
      exp: 2_000_000_100,
    });
    const createUserClient = vi.fn().mockReturnValue(client);
    const loadGrant = vi.fn().mockResolvedValue({
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
      createAuthenticatedMcpContext(bearerHeaders(), {
        issuer: ISSUER,
        audience: AUDIENCE,
        nowSeconds: 2_000_000_000,
        verifyAccessToken,
        createUserClient,
        loadGrant,
      }),
    ).resolves.toEqual({
      client,
      principal: {
        ownerUserId: USER_ID,
        oauthClientId: CLIENT_ID,
        grantId: "10000000-0000-0000-0000-000000000001",
        permissionProfile: "read_only",
        permissionsVersion: 1,
        permissions: ["projects.read", "goals.read", "tasks.read"],
      },
    });

    expect(createUserClient).toHaveBeenCalledWith("signed-token");
    expect(loadGrant).toHaveBeenCalledWith(
      client,
      USER_ID,
      CLIENT_ID,
      AUDIENCE,
    );
  });

  it("does not create a database client when token verification fails", async () => {
    const createUserClient = vi.fn();

    await expect(
      createAuthenticatedMcpContext(bearerHeaders(), {
        issuer: ISSUER,
        audience: AUDIENCE,
        nowSeconds: 2_000_000_000,
        verifyAccessToken: vi.fn().mockRejectedValue(new Error("bad token")),
        createUserClient,
        loadGrant: vi.fn(),
      }),
    ).rejects.toEqual(
      expect.objectContaining({ code: "UNAUTHENTICATED", status: 401 }),
    );

    expect(createUserClient).not.toHaveBeenCalled();
  });

  it("fails closed when the client has no active grant", async () => {
    const client = {} as SupabaseClient<McpDatabase>;

    await expect(
      createAuthenticatedMcpContext(bearerHeaders(), {
        issuer: ISSUER,
        audience: AUDIENCE,
        nowSeconds: 2_000_000_000,
        verifyAccessToken: vi.fn().mockResolvedValue({
          iss: ISSUER,
          aud: AUDIENCE,
          sub: USER_ID,
          client_id: CLIENT_ID,
          exp: 2_000_000_100,
        }),
        createUserClient: vi.fn().mockReturnValue(client),
        loadGrant: vi.fn().mockResolvedValue(null),
      }),
    ).rejects.toEqual(
      expect.objectContaining({ code: "PERMISSION_DENIED", status: 403 }),
    );
  });
});
