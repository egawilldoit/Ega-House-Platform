import { describe, expect, it } from "vitest";

import { getPermissionsForProfile } from "@/lib/mcp/permissions";
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
  // Derived from the canonical document so this fixture cannot drift from the
  // authority it is meant to represent. It previously listed only three of the
  // five v1 read_only permissions - a principal outside its own profile, which
  // the old weak auth-info validator silently accepted.
  permissions: getPermissionsForProfile("read_only", 1),
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

  /**
   * Authorisation must run on the SAME validator as tool discovery. A principal
   * whose permission set is outside its own (profile, version) document used to
   * pass authorisation on a weaker structural check and then fail discovery, so
   * the two paths disagreed about the same principal. Each case here carries a
   * permission the request needs, so a validator that only checked membership
   * would authorise it.
   */
  it.each([
    [
      "a permission outside the profile's document",
      { ...PRINCIPAL, permissions: [...PRINCIPAL.permissions, "tasks.create"] },
    ],
    [
      "a permission substituted into the document",
      {
        ...PRINCIPAL,
        permissions: [
          "projects.read",
          "goals.read",
          "tasks.read",
          "today.read",
          "friction.read",
        ],
      },
    ],
    [
      "a duplicated permission",
      { ...PRINCIPAL, permissions: [...PRINCIPAL.permissions, "tasks.read"] },
    ],
    ["a version the build cannot authorise", { ...PRINCIPAL, permissionsVersion: 3 }],
    ["the retired delivery_observer profile", { ...PRINCIPAL, permissionProfile: "delivery_observer" }],
  ])("refuses a principal carrying %s", (_label, principal) => {
    expect(() =>
      requireMcpPermission(
        createMcpAuthInfo("test-bearer", principal as McpPrincipal),
        "tasks.read",
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "UNAUTHENTICATED",
        message: "Authentication is required for this tool.",
      }),
    );
  });

  it("refuses a v1 document presented as a v2 grant", () => {
    expect(() =>
      requireMcpPermission(
        createMcpAuthInfo("test-bearer", {
          ...PRINCIPAL,
          permissionsVersion: 2,
        }),
        "tasks.read",
      ),
    ).toThrow(McpToolAuthorizationError);
  });

  it("authorises a v2 read domain only for a principal whose v2 document carries it", () => {
    const v2Principal: McpPrincipal = {
      ...PRINCIPAL,
      permissionsVersion: 2,
      permissions: [
        ...PRINCIPAL.permissions,
        "friction.read",
        "inbox.read",
        "notifications.read",
        "operator.read",
        "workload.read",
      ],
    };

    expect(
      requireMcpPermission(createMcpAuthInfo("test-bearer", v2Principal), "inbox.read")
        .permissionsVersion,
    ).toBe(2);
    expect(() =>
      requireMcpPermission(createMcpAuthInfo("test-bearer", PRINCIPAL), "inbox.read"),
    ).toThrowError(
      expect.objectContaining({
        code: "PERMISSION_DENIED",
        message: "The active EGA grant does not allow inbox.read.",
      }),
    );
  });
});
