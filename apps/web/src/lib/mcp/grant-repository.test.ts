import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { loadActiveMcpGrant } from "@/lib/mcp/grant-repository";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";

const OWNER_USER_ID = "00000000-0000-0000-0000-000000000001";
const OAUTH_CLIENT_ID = "hermes-client";
const RESOURCE_URI = "https://ega.example.com/api/mcp";

function createRpcClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);

  return {
    client: { rpc } as unknown as SupabaseClient<McpDatabase>,
    rpc,
  };
}

describe("loadActiveMcpGrant", () => {
  it("loads one active grant for the user, client, and MCP resource", async () => {
    const query = createRpcClient({
      data: [{
        id: "10000000-0000-0000-0000-000000000001",
        owner_user_id: OWNER_USER_ID,
        oauth_client_id: OAUTH_CLIENT_ID,
        resource_uri: RESOURCE_URI,
        status: "active",
        permission_profile: "read_only",
        permissions: ["projects.read", "goals.read", "tasks.read"],
        permissions_version: 2,
      }],
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

    expect(query.rpc).toHaveBeenCalledWith("resolve_active_mcp_grant");
  });

  it("returns null when no active grant exists", async () => {
    const query = createRpcClient({ data: [], error: null });

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
    const query = createRpcClient({
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
    const query = createRpcClient({
      data: [{
        id: "grant-id",
        owner_user_id: OWNER_USER_ID,
        oauth_client_id: OAUTH_CLIENT_ID,
        resource_uri: "",
        status: "active",
        permission_profile: "read_only",
        permissions: {},
        permissions_version: 0,
      }],
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

  /**
   * `permissions_version` is an integer column, so the number that reaches
   * McpGrantRecord - and from there the MRTR confirmation binding - is validated
   * here, at the boundary that reads the row, rather than one layer in. Each
   * case is a value the column's type could carry or a future constraint could
   * admit; none may be coerced into McpGrantRecord.
   */
  it.each([
    ["a version below one", 0],
    ["a negative version", -1],
    ["a future version", 3],
    ["a far-future version", 99],
    ["a non-integer version", 1.5],
    ["a numeric string version", "1"],
    ["a null version", null],
    ["an absent version", undefined],
  ])("refuses a row claiming %s", async (_label, permissionsVersion) => {
    const query = createRpcClient({
      data: [{
        id: "10000000-0000-0000-0000-000000000001",
        owner_user_id: OWNER_USER_ID,
        oauth_client_id: OAUTH_CLIENT_ID,
        resource_uri: RESOURCE_URI,
        status: "active",
        permission_profile: "read_only",
        permissions: ["projects.read", "goals.read", "tasks.read"],
        permissions_version: permissionsVersion,
      }],
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

  it.each([
    ["an unknown profile", "administrator"],
    ["the retired delivery_observer profile", "delivery_observer"],
  ])("refuses a row claiming %s", async (_label, permission_profile) => {
    const query = createRpcClient({
      data: [{
        id: "10000000-0000-0000-0000-000000000001",
        owner_user_id: OWNER_USER_ID,
        oauth_client_id: OAUTH_CLIENT_ID,
        resource_uri: RESOURCE_URI,
        status: "active",
        permission_profile,
        permissions: ["projects.read", "goals.read", "tasks.read"],
        permissions_version: 1,
      }],
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

  it.each([
    ["pending", "pending"],
    ["failed", "failed"],
    ["revoked", "revoked"],
  ])("refuses a %s row from the active-grant RPC", async (_label, status) => {
    const query = createRpcClient({
      data: [{
        id: "10000000-0000-0000-0000-000000000001",
        owner_user_id: OWNER_USER_ID,
        oauth_client_id: OAUTH_CLIENT_ID,
        resource_uri: RESOURCE_URI,
        status,
        permission_profile: "read_only",
        permissions: ["projects.read", "goals.read", "tasks.read"],
        permissions_version: 1,
      }],
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

  it.each([
    ["owner", { owner_user_id: "00000000-0000-0000-0000-000000000002" }],
    ["client", { oauth_client_id: "other-client" }],
    ["resource", { resource_uri: "https://other.example.com/api/mcp" }],
  ])("fails closed when the RPC result has a mismatched %s", async (_field, mismatch) => {
    const query = createRpcClient({
      data: [{
        id: "10000000-0000-0000-0000-000000000001",
        owner_user_id: OWNER_USER_ID,
        oauth_client_id: OAUTH_CLIENT_ID,
        resource_uri: RESOURCE_URI,
        status: "active",
        permission_profile: "read_only",
        permissions: ["projects.read", "goals.read", "tasks.read"],
        permissions_version: 2,
        ...mismatch,
      }],
      error: null,
    });

    await expect(
      loadActiveMcpGrant(
        query.client,
        OWNER_USER_ID,
        OAUTH_CLIENT_ID,
        RESOURCE_URI,
      ),
    ).rejects.toThrow("MCP authorization grant does not match request context.");
  });
});
