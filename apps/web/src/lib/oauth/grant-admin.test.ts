import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  activateReadOnlyMcpGrant,
  markMcpGrantFailed,
} from "@/lib/oauth/grant-admin";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";

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
        clientName: "Example App",
        resourceUri: "https://preview.example/api/mcp",
        now: "2026-08-01T18:00:00.000Z",
      }),
    ).resolves.toBe("grant-123");

    expect(from).toHaveBeenCalledWith("mcp_authorization_grants");
    expect(upsert).toHaveBeenCalledWith(
      {
        owner_user_id: "user-123",
        oauth_client_id: "client-123",
        client_name: "Example App",
        resource_uri: "https://preview.example/api/mcp",
        status: "active",
        permission_profile: "read_only",
        permissions: ["projects.read", "goals.read", "tasks.read"],
        permissions_version: 1,
        approved_at: "2026-08-01T18:00:00.000Z",
        revoked_at: null,
        updated_at: "2026-08-01T18:00:00.000Z",
      },
      { onConflict: "owner_user_id,oauth_client_id" },
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
        clientName: "Example App",
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
