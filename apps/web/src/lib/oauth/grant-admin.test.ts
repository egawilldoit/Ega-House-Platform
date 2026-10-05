import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  activateMcpGrant,
  activateReadOnlyMcpGrant,
  markMcpGrantFailed,
} from "@/lib/oauth/grant-admin";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import {
  CURRENT_MCP_PERMISSION_VERSION,
  getPermissionsForProfile,
} from "@/lib/mcp/permissions";

function createAdminClient(options?: {
  upsertError?: unknown;
  updateError?: unknown;
}) {
  const single = vi.fn().mockResolvedValue({
    data: options?.upsertError ? null : { id: "grant-123" },
    error: options?.upsertError ?? null,
  });
  const select = vi.fn().mockReturnValue({ single });
  const upsert = vi.fn().mockReturnValue({ select });

  const secondEq = vi.fn().mockResolvedValue({
    error: options?.updateError ?? null,
  });
  const firstEq = vi.fn().mockReturnValue({ eq: secondEq });
  const update = vi.fn().mockReturnValue({ eq: firstEq });
  const from = vi.fn().mockReturnValue({ upsert, update });

  return {
    client: { from } as unknown as SupabaseClient<McpDatabase>,
    from,
    upsert,
    update,
    firstEq,
    secondEq,
  };
}

describe("OAuth MCP grant administration", () => {
  it("activates the exact user, client, resource, and read-only permission set", async () => {
    const { client, from, upsert } = createAdminClient();

    await expect(
      activateReadOnlyMcpGrant(client, {
        ownerUserId: "user-123",
        oauthClientId: "client-123",
        clientName: "Hermes",
        resourceUri: "https://preview.example/api/mcp",
        now: "2026-08-01T18:00:00.000Z",
      }),
    ).resolves.toBe("grant-123");

    expect(from).toHaveBeenCalledWith("mcp_authorization_grants");
    expect(upsert).toHaveBeenCalledWith(
      {
        owner_user_id: "user-123",
        oauth_client_id: "client-123",
        client_name: "Hermes",
        resource_uri: "https://preview.example/api/mcp",
        status: "active",
        permission_profile: "read_only",
        permissions: ["projects.read", "goals.read", "tasks.read", "today.read", "timer.read"],
        permissions_version: 1,
        approved_at: "2026-08-01T18:00:00.000Z",
        revoked_at: null,
        updated_at: "2026-08-01T18:00:00.000Z",
      },
      { onConflict: "owner_user_id,oauth_client_id" },
    );
  });

  it("activates the exact workspace-manager permission set", async () => {
    const { client, upsert } = createAdminClient();

    await expect(
      activateMcpGrant(client, {
        ownerUserId: "user-123",
        oauthClientId: "client-123",
        clientName: "Hermes",
        resourceUri: "https://preview.example/api/mcp",
        permissionProfile: "workspace_manager",
        now: "2026-08-01T18:00:00.000Z",
      }),
    ).resolves.toBe("grant-123");

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        permission_profile: "workspace_manager",
        permissions: [
          "projects.read",
          "projects.create",
          "projects.update",
          "goals.read",
          "goals.create",
          "goals.update",
          "tasks.read",
          "tasks.create",
          "tasks.update",
          "today.read",
          "today.update",
          "timer.read",
          "timer.create",
          "timer.update",
        ],
        permissions_version: 1,
      }),
      { onConflict: "owner_user_id,oauth_client_id" },
    );
  });

  /**
   * This is the only writer of a permission document, so it is what keeps
   * permissions_version 2 defined but unissued: the version and the document are
   * written from the same constant, so no consent decision, and no caller of
   * this module, can pair a document with a version it was not defined under.
   * Derived from the resolver rather than restated, so the assertion cannot
   * drift from the authority it is checking.
   */
  it("writes the issued version and the document that version defines", async () => {
    for (const profile of ["read_only", "workspace_manager"] as const) {
      const { client, upsert } = createAdminClient();

      await activateMcpGrant(client, {
        ownerUserId: "user-123",
        oauthClientId: "client-123",
        clientName: "Hermes",
        resourceUri: "https://preview.example/api/mcp",
        permissionProfile: profile,
        now: "2026-08-01T18:00:00.000Z",
      });

      const written = upsert.mock.calls[0][0];
      expect(written.permissions_version).toBe(CURRENT_MCP_PERMISSION_VERSION);
      expect(written.permissions).toEqual(
        getPermissionsForProfile(profile, CURRENT_MCP_PERMISSION_VERSION),
      );
      // A v2-only permission is in no issued document, so nothing this module
      // writes can promise it.
      for (const additive of ["friction.read", "inbox.read", "workload.read"]) {
        expect(written.permissions).not.toContain(additive);
      }
    }
  });

  it("defaults to the read-only profile rather than a wider one", async () => {
    const { client, upsert } = createAdminClient();

    await activateMcpGrant(client, {
      ownerUserId: "user-123",
      oauthClientId: "client-123",
      clientName: "Hermes",
      resourceUri: "https://preview.example/api/mcp",
      now: "2026-08-01T18:00:00.000Z",
    });

    expect(upsert.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        permission_profile: "read_only",
        permissions: getPermissionsForProfile("read_only", 1),
        permissions_version: 1,
      }),
    );
  });

  it("redacts grant activation failures", async () => {
    const { client } = createAdminClient({
      upsertError: { message: "sensitive database detail" },
    });

    await expect(
      activateReadOnlyMcpGrant(client, {
        ownerUserId: "user-123",
        oauthClientId: "client-123",
        clientName: "Hermes",
        resourceUri: "https://preview.example/api/mcp",
      }),
    ).rejects.toThrow("Failed to activate EGA MCP authorization grant.");
  });

  it("marks the same user/client grant failed when OAuth approval fails", async () => {
    const { client, update, firstEq, secondEq } = createAdminClient();

    await expect(
      markMcpGrantFailed(client, {
        ownerUserId: "user-123",
        oauthClientId: "client-123",
        now: "2026-08-01T18:05:00.000Z",
      }),
    ).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledWith({
      status: "failed",
      revoked_at: "2026-08-01T18:05:00.000Z",
      updated_at: "2026-08-01T18:05:00.000Z",
    });
    expect(firstEq).toHaveBeenCalledWith("owner_user_id", "user-123");
    expect(secondEq).toHaveBeenCalledWith("oauth_client_id", "client-123");
  });
});
