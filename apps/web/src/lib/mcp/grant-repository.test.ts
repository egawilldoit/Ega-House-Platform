import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { loadActiveMcpGrant } from "@/lib/mcp/grant-repository";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";

const OWNER_USER_ID = "00000000-0000-0000-0000-000000000001";
const OAUTH_CLIENT_ID = "test-mcp-client";
const RESOURCE_URI = "https://ega.example.com/api/mcp";

function createQueryClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eqStatus = vi.fn().mockReturnValue({ maybeSingle });
  const eqResource = vi.fn().mockReturnValue({ eq: eqStatus });
  const eqClient = vi.fn().mockReturnValue({ eq: eqResource });
  const eqOwner = vi.fn().mockReturnValue({ eq: eqClient });
  const select = vi.fn().mockReturnValue({ eq: eqOwner });
  const from = vi.fn().mockReturnValue({ select });

  return {
    client: { from } as unknown as SupabaseClient<McpDatabase>,
    from,
    select,
    eqOwner,
    eqClient,
    eqResource,
    eqStatus,
    maybeSingle,
  };
}

describe("loadActiveMcpGrant", () => {
  it("loads one active grant for the user, client, and MCP resource", async () => {
    const query = createQueryClient({
      data: {
        id: "10000000-0000-0000-0000-000000000001",
        owner_user_id: OWNER_USER_ID,
        oauth_client_id: OAUTH_CLIENT_ID,
        resource_uri: RESOURCE_URI,
        status: "active",
        permission_profile: "read_only",
        permissions: ["projects.read", "goals.read", "tasks.read"],
        permissions_version: 2,
      },
      error: null,
    });

    await expect(
      loadActiveMcpGrant(
        query.client,
        OWNER_USER_ID,
        OAUTH_CLIENT_ID,
        RESOURCE_URI,
      ),
    ).resolves.toEqual({
      id: "10000000-0000-0000-0000-000000000001",
      ownerUserId: OWNER_USER_ID,
      oauthClientId: OAUTH_CLIENT_ID,
      resourceUri: RESOURCE_URI,
      status: "active",
      permissionProfile: "read_only",
      permissions: ["projects.read", "goals.read", "tasks.read"],
      permissionsVersion: 2,
    });

    expect(query.from).toHaveBeenCalledWith("mcp_authorization_grants");
    expect(query.eqOwner).toHaveBeenCalledWith("owner_user_id", OWNER_USER_ID);
    expect(query.eqClient).toHaveBeenCalledWith(
      "oauth_client_id",
      OAUTH_CLIENT_ID,
    );
    expect(query.eqResource).toHaveBeenCalledWith("resource_uri", RESOURCE_URI);
    expect(query.eqStatus).toHaveBeenCalledWith("status", "active");
  });

  it("returns null when no active grant exists", async () => {
    const query = createQueryClient({ data: null, error: null });

    await expect(
      loadActiveMcpGrant(
        query.client,
        OWNER_USER_ID,
        OAUTH_CLIENT_ID,
        RESOURCE_URI,
      ),
    ).resolves.toBeNull();
  });

  it("redacts database errors", async () => {
    const query = createQueryClient({
      data: null,
      error: { message: "sensitive database detail" },
    });

    await expect(
      loadActiveMcpGrant(
        query.client,
        OWNER_USER_ID,
        OAUTH_CLIENT_ID,
        RESOURCE_URI,
      ),
    ).rejects.toThrow("Failed to load EGA MCP authorization grant.");
  });

  it("rejects malformed active grant rows", async () => {
    const query = createQueryClient({
      data: {
        id: "grant-id",
        owner_user_id: OWNER_USER_ID,
        oauth_client_id: OAUTH_CLIENT_ID,
        resource_uri: "",
        status: "active",
        permission_profile: "read_only",
        permissions: {},
        permissions_version: 0,
      },
      error: null,
    });

    await expect(
      loadActiveMcpGrant(
        query.client,
        OWNER_USER_ID,
        OAUTH_CLIENT_ID,
        RESOURCE_URI,
      ),
    ).rejects.toThrow("Invalid EGA MCP authorization grant record.");
  });
});
