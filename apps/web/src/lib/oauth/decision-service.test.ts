import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { processOAuthConsentDecision } from "@/lib/oauth/decision-service";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";

function authorizationDetails() {
  return {
    authorization_id: "authorization-123",
    client: { client_id: "client-123", name: "Hermes" },
    redirect_uri: "http://127.0.0.1:3210/callback",
    scope: "openid email",
  };
}

describe("OAuth consent decision service", () => {
  it("denies without creating an EGA grant", async () => {
    const activateGrant = vi.fn();
    const denyAuthorization = vi.fn().mockResolvedValue({
      data: { redirect_url: "http://127.0.0.1:3210/callback?error=access_denied" },
      error: null,
    });

    await expect(
      processOAuthConsentDecision({
        decision: "deny",
        authorizationId: "authorization-123",
        ownerUserId: "user-123",
        resourceUri: "https://preview.example/api/mcp",
        oauth: {
          getAuthorizationDetails: vi.fn().mockResolvedValue({
            data: authorizationDetails(),
            error: null,
          }),
          approveAuthorization: vi.fn(),
          denyAuthorization,
        },
        admin: {} as SupabaseClient<McpDatabase>,
        activateGrant,
        failGrant: vi.fn(),
      }),
    ).resolves.toBe(
      "http://127.0.0.1:3210/callback?error=access_denied",
    );

    expect(activateGrant).not.toHaveBeenCalled();
    expect(denyAuthorization).toHaveBeenCalledWith("authorization-123");
  });

  it("activates the read-only grant before approving authorization", async () => {
    const originalWritesFlag = process.env.MCP_WRITES_ENABLED;
    process.env.MCP_WRITES_ENABLED = "true";
    const order: string[] = [];
    const activateGrant = vi.fn(async () => {
      order.push("grant");
      return "grant-123";
    });
    const approveAuthorization = vi.fn(async () => {
      order.push("approve");
      return {
        data: { redirect_url: "http://127.0.0.1:3210/callback?code=code-123" },
        error: null,
      };
    });

    try {
      await expect(
        processOAuthConsentDecision({
          decision: "approve",
          authorizationId: "authorization-123",
          ownerUserId: "user-123",
          resourceUri: "https://preview.example/api/mcp",
          oauth: {
            getAuthorizationDetails: vi.fn().mockResolvedValue({
              data: authorizationDetails(),
              error: null,
            }),
            approveAuthorization,
            denyAuthorization: vi.fn(),
          },
          admin: {} as SupabaseClient<McpDatabase>,
          activateGrant,
          failGrant: vi.fn(),
        }),
      ).resolves.toBe(
        "http://127.0.0.1:3210/callback?code=code-123",
      );

      expect(order).toEqual(["grant", "approve"]);
      expect(activateGrant).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          ownerUserId: "user-123",
          oauthClientId: "client-123",
          clientName: "Hermes",
          resourceUri: "https://preview.example/api/mcp",
          permissionProfile: "read_only",
        }),
      );
    } finally {
      if (originalWritesFlag === undefined) {
        delete process.env.MCP_WRITES_ENABLED;
      } else {
        process.env.MCP_WRITES_ENABLED = originalWritesFlag;
      }
    }
  });

  it("persists workspace_manager when writes are enabled", async () => {
    const originalWritesFlag = process.env.MCP_WRITES_ENABLED;
    process.env.MCP_WRITES_ENABLED = "true";

    const single = vi.fn().mockResolvedValue({
      data: { id: "grant-123" },
      error: null,
    });
    const select = vi.fn().mockReturnValue({ single });
    const upsert = vi.fn().mockReturnValue({ select });
    const admin = {
      from: vi.fn().mockReturnValue({ upsert }),
    } as unknown as SupabaseClient<McpDatabase>;

    try {
      await expect(
        processOAuthConsentDecision({
          decision: "approve",
          authorizationId: "authorization-123",
          ownerUserId: "user-123",
          resourceUri: "https://preview.example/api/mcp",
          permissionProfile: "workspace_manager",
          oauth: {
            getAuthorizationDetails: vi.fn().mockResolvedValue({
              data: authorizationDetails(),
              error: null,
            }),
            approveAuthorization: vi.fn().mockResolvedValue({
              data: { redirect_url: "http://127.0.0.1:3210/callback?code=code-123" },
              error: null,
            }),
            denyAuthorization: vi.fn(),
          },
          admin,
        }),
      ).resolves.toBe("http://127.0.0.1:3210/callback?code=code-123");

      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          permission_profile: "workspace_manager",
        }),
        { onConflict: "owner_user_id,oauth_client_id" },
      );
    } finally {
      if (originalWritesFlag === undefined) {
        delete process.env.MCP_WRITES_ENABLED;
      } else {
        process.env.MCP_WRITES_ENABLED = originalWritesFlag;
      }
    }
  });

  it("downgrades workspace_manager to read_only when writes are disabled", async () => {
    const originalWritesFlag = process.env.MCP_WRITES_ENABLED;
    process.env.MCP_WRITES_ENABLED = "false";
    const single = vi.fn().mockResolvedValue({ data: { id: "grant-123" }, error: null });
    const upsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ single }),
    });
    const admin = {
      from: vi.fn().mockReturnValue({ upsert }),
    } as unknown as SupabaseClient<McpDatabase>;

    try {
      await processOAuthConsentDecision({
        decision: "approve",
        authorizationId: "authorization-123",
        ownerUserId: "user-123",
        resourceUri: "https://preview.example/api/mcp",
        permissionProfile: "workspace_manager",
        oauth: {
          getAuthorizationDetails: vi.fn().mockResolvedValue({
            data: authorizationDetails(),
            error: null,
          }),
          approveAuthorization: vi.fn().mockResolvedValue({
            data: { redirect_url: "http://127.0.0.1:3210/callback?code=code-123" },
            error: null,
          }),
          denyAuthorization: vi.fn(),
        },
        admin,
      });

      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          permission_profile: "read_only",
          permissions: [
            "projects.read",
            "goals.read",
            "tasks.read",
            "today.read",
            "timer.read",
          ],
        }),
        { onConflict: "owner_user_id,oauth_client_id" },
      );
    } finally {
      if (originalWritesFlag === undefined) {
        delete process.env.MCP_WRITES_ENABLED;
      } else {
        process.env.MCP_WRITES_ENABLED = originalWritesFlag;
      }
    }
  });

  it("defaults an omitted permission profile to read_only", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "grant-123" }, error: null });
    const upsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ single }),
    });
    const admin = {
      from: vi.fn().mockReturnValue({ upsert }),
    } as unknown as SupabaseClient<McpDatabase>;

    await processOAuthConsentDecision({
      decision: "approve",
      authorizationId: "authorization-123",
      ownerUserId: "user-123",
      resourceUri: "https://preview.example/api/mcp",
      oauth: {
        getAuthorizationDetails: vi.fn().mockResolvedValue({
          data: authorizationDetails(),
          error: null,
        }),
        approveAuthorization: vi.fn().mockResolvedValue({
          data: { redirect_url: "http://127.0.0.1:3210/callback?code=code-123" },
          error: null,
        }),
        denyAuthorization: vi.fn(),
      },
      admin,
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ permission_profile: "read_only" }),
      { onConflict: "owner_user_id,oauth_client_id" },
    );
  });

  it("rejects unsupported permission profiles before activation", async () => {
    const activateGrant = vi.fn();

    await expect(
      processOAuthConsentDecision({
        decision: "approve",
        authorizationId: "authorization-123",
        ownerUserId: "user-123",
        resourceUri: "https://preview.example/api/mcp",
        permissionProfile: "operator_admin",
        oauth: {
          getAuthorizationDetails: vi.fn().mockResolvedValue({
            data: authorizationDetails(),
            error: null,
          }),
          approveAuthorization: vi.fn(),
          denyAuthorization: vi.fn(),
        },
        admin: {} as SupabaseClient<McpDatabase>,
        activateGrant,
      }),
    ).rejects.toThrow("Unsupported MCP permission profile.");

    expect(activateGrant).not.toHaveBeenCalled();
  });

  it("fails the activated grant when Supabase approval fails", async () => {
    const failGrant = vi.fn().mockResolvedValue(undefined);

    await expect(
      processOAuthConsentDecision({
        decision: "approve",
        authorizationId: "authorization-123",
        ownerUserId: "user-123",
        resourceUri: "https://preview.example/api/mcp",
        oauth: {
          getAuthorizationDetails: vi.fn().mockResolvedValue({
            data: authorizationDetails(),
            error: null,
          }),
          approveAuthorization: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "sensitive provider failure" },
          }),
          denyAuthorization: vi.fn(),
        },
        admin: {} as SupabaseClient<McpDatabase>,
        activateGrant: vi.fn().mockResolvedValue("grant-123"),
        failGrant,
      }),
    ).rejects.toThrow("Failed to approve OAuth authorization request.");

    expect(failGrant).toHaveBeenCalledWith(expect.anything(), {
      ownerUserId: "user-123",
      oauthClientId: "client-123",
    });
  });

  it("rejects invalid authorization detail responses", async () => {
    await expect(
      processOAuthConsentDecision({
        decision: "approve",
        authorizationId: "authorization-123",
        ownerUserId: "user-123",
        resourceUri: "https://preview.example/api/mcp",
        oauth: {
          getAuthorizationDetails: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "sensitive detail" },
          }),
          approveAuthorization: vi.fn(),
          denyAuthorization: vi.fn(),
        },
        admin: {} as SupabaseClient<McpDatabase>,
        activateGrant: vi.fn(),
        failGrant: vi.fn(),
      }),
    ).rejects.toThrow("Invalid OAuth authorization request.");
  });
});
