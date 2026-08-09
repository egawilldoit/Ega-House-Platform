import { describe, expect, it } from "vitest";

import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import {
  McpToolAuthorizationError,
  requireMcpPermission,
} from "@/lib/mcp/tool-authorization";
import type { McpPrincipal } from "@/lib/mcp/principal";

const PRINCIPAL: McpPrincipal = {
  ownerUserId: "00000000-0000-0000-0000-000000000001",
  oauthClientId: "hermes-client",
  grantId: "10000000-0000-0000-0000-000000000001",
  permissionProfile: "read_only",
  permissionsVersion: 1,
  permissions: ["projects.read", "goals.read", "tasks.read"],
};

describe("requireMcpPermission", () => {
  it("returns the principal when the permission is granted", () => {
    expect(
      requireMcpPermission(
        createMcpAuthInfo("test-bearer", PRINCIPAL),
        "tasks.read",
      ),
    ).toEqual(PRINCIPAL);
  });

  it("rejects a missing auth context", () => {
    expect(() => requireMcpPermission(undefined, "tasks.read")).toThrowError(
      expect.objectContaining({
        code: "UNAUTHENTICATED",
        message: "Authentication is required for this tool.",
      }),
    );
  });

  it("rejects a valid principal without the required permission", () => {
    expect(() =>
      requireMcpPermission(
        createMcpAuthInfo("test-bearer", PRINCIPAL),
        "tasks.create",
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "PERMISSION_DENIED",
        message: "The active EGA grant does not allow tasks.create.",
      }),
    );
  });

  it("rejects malformed auth information instead of trusting scopes alone", () => {
    expect(() =>
      requireMcpPermission(
        {
          token: "test-bearer",
          clientId: "hermes-client",
          scopes: ["ega.mcp.authorized", "tasks.read"],
          extra: {},
        },
        "tasks.read",
      ),
    ).toThrow(McpToolAuthorizationError);
  });
});
