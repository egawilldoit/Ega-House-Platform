import { describe, expect, it } from "vitest";

import {
  McpAuthorizationError,
  resolveMcpPrincipal,
  type McpGrantRecord,
} from "@/lib/mcp/principal";

const CLAIMS = {
  sub: "00000000-0000-0000-0000-000000000001",
  client_id: "hermes-client",
};

const ACTIVE_GRANT: McpGrantRecord = {
  id: "10000000-0000-0000-0000-000000000001",
  ownerUserId: CLAIMS.sub,
  oauthClientId: CLAIMS.client_id,
  resourceUri: "https://ega.example.com/api/mcp",
  status: "active",
  permissionProfile: "read_only",
  permissions: ["projects.read", "goals.read", "tasks.read", "today.read", "timer.read"],
  permissionsVersion: 1,
};

describe("resolveMcpPrincipal", () => {
  it("resolves an active matching client and user grant", () => {
    expect(resolveMcpPrincipal(CLAIMS, ACTIVE_GRANT)).toEqual({
      ownerUserId: CLAIMS.sub,
      oauthClientId: CLAIMS.client_id,
      grantId: ACTIVE_GRANT.id,
      permissionProfile: "read_only",
      permissionsVersion: 1,
      permissions: ["projects.read", "goals.read", "tasks.read", "today.read", "timer.read"],
    });
  });

  it.each([
    [{ client_id: CLAIMS.client_id }, "sub"],
    [{ sub: CLAIMS.sub }, "client_id"],
    [{ sub: "", client_id: CLAIMS.client_id }, "sub"],
    [{ sub: CLAIMS.sub, client_id: "" }, "client_id"],
  ])("rejects missing or empty token claim %s", (claims, claimName) => {
    expect(() => resolveMcpPrincipal(claims, ACTIVE_GRANT)).toThrowError(
      expect.objectContaining({
        code: "UNAUTHENTICATED",
        status: 401,
        message: `Missing or invalid ${claimName} claim.`,
      }),
    );
  });

  it("rejects a missing EGA authorization grant", () => {
    expect(() => resolveMcpPrincipal(CLAIMS, null)).toThrowError(
      expect.objectContaining({
        code: "PERMISSION_DENIED",
        status: 403,
        message: "No active EGA MCP authorization grant.",
      }),
    );
  });

  it.each(["pending", "failed", "revoked"] as const)(
    "rejects a %s grant",
    (status) => {
      expect(() =>
        resolveMcpPrincipal(CLAIMS, { ...ACTIVE_GRANT, status }),
      ).toThrowError(McpAuthorizationError);
    },
  );

  it("rejects a grant owned by another user", () => {
    expect(() =>
      resolveMcpPrincipal(CLAIMS, {
        ...ACTIVE_GRANT,
        ownerUserId: "00000000-0000-0000-0000-000000000099",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "PERMISSION_DENIED", status: 403 }),
    );
  });

  it("rejects a grant issued to another OAuth client", () => {
    expect(() =>
      resolveMcpPrincipal(CLAIMS, {
        ...ACTIVE_GRANT,
        oauthClientId: "codex-client",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "PERMISSION_DENIED", status: 403 }),
    );
  });

  it("rejects a grant without a resource binding", () => {
    expect(() =>
      resolveMcpPrincipal(CLAIMS, {
        ...ACTIVE_GRANT,
        resourceUri: "",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "PERMISSION_DENIED", status: 403 }),
    );
  });

  it("rejects an unsupported permission profile", () => {
    expect(() =>
      resolveMcpPrincipal(CLAIMS, {
        ...ACTIVE_GRANT,
        permissionProfile: "administrator",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "PERMISSION_DENIED", status: 403 }),
    );
  });

  it("rejects a permission document that does not match the profile", () => {
    expect(() =>
      resolveMcpPrincipal(CLAIMS, {
        ...ACTIVE_GRANT,
        permissions: ["projects.read", "tasks.create"],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "PERMISSION_DENIED", status: 403 }),
    );
  });

  it("rejects duplicate permission entries", () => {
    expect(() =>
      resolveMcpPrincipal(CLAIMS, {
        ...ACTIVE_GRANT,
        permissions: [
          "projects.read",
          "goals.read",
          "tasks.read",
          "today.read",
          "timer.read",
          "timer.read",
        ],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "PERMISSION_DENIED", status: 403 }),
    );
  });

  it("rejects an extra permission outside the profile's own document", () => {
    // Fails closed on WIDENING. read_only at v1 must not be able to talk its
    // way to tasks.create by carrying it.
    expect(() =>
      resolveMcpPrincipal(CLAIMS, {
        ...ACTIVE_GRANT,
        permissions: [
          "projects.read",
          "goals.read",
          "tasks.read",
          "today.read",
          "timer.read",
          "tasks.create",
        ],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "PERMISSION_DENIED", status: 403 }),
    );
  });

  it("rejects a same-length substitution, so the check is set equality and not a length", () => {
    // The discriminating case for the check above. Every entry is a real
    // permission and the array is exactly as long as the v1 read_only document,
    // so a validator that compared only lengths would accept this grant and hand
    // a read_only connection a permissions_version 2 read domain.
    expect(() =>
      resolveMcpPrincipal(CLAIMS, {
        ...ACTIVE_GRANT,
        permissions: [
          "projects.read",
          "goals.read",
          "tasks.read",
          "today.read",
          "friction.read",
        ],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "PERMISSION_DENIED", status: 403 }),
    );
  });

  it("rejects a document missing one of the profile's permissions", () => {
    expect(() =>
      resolveMcpPrincipal(CLAIMS, {
        ...ACTIVE_GRANT,
        permissions: ["projects.read", "goals.read", "tasks.read", "today.read"],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "PERMISSION_DENIED", status: 403 }),
    );
  });

  it("accepts the same document in a different order, because permissions are a set", () => {
    expect(
      resolveMcpPrincipal(CLAIMS, {
        ...ACTIVE_GRANT,
        permissions: [
          "timer.read",
          "today.read",
          "tasks.read",
          "goals.read",
          "projects.read",
        ],
      }).permissions,
    ).toEqual([
      "projects.read",
      "goals.read",
      "tasks.read",
      "today.read",
      "timer.read",
    ]);
  });

  it("authorises a v2 grant against its own frozen document, not the v1 one", () => {
    // v2 is defined and must be resolvable; what keeps it unissued is that no
    // writer emits it, not that the resolver refuses to understand it.
    expect(
      resolveMcpPrincipal(CLAIMS, {
        ...ACTIVE_GRANT,
        permissionsVersion: 2,
        permissions: [
          "projects.read",
          "goals.read",
          "tasks.read",
          "today.read",
          "timer.read",
          "friction.read",
          "inbox.read",
          "notifications.read",
          "operator.read",
          "workload.read",
        ],
      }),
    ).toEqual({
      ownerUserId: CLAIMS.sub,
      oauthClientId: CLAIMS.client_id,
      grantId: ACTIVE_GRANT.id,
      permissionProfile: "read_only",
      permissionsVersion: 2,
      permissions: [
        "projects.read",
        "goals.read",
        "tasks.read",
        "today.read",
        "timer.read",
        "friction.read",
        "inbox.read",
        "notifications.read",
        "operator.read",
        "workload.read",
      ],
    });
  });

  it("rejects a v1 document carried by a v2 row", () => {
    expect(() =>
      resolveMcpPrincipal(CLAIMS, {
        ...ACTIVE_GRANT,
        permissionsVersion: 2,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "PERMISSION_DENIED", status: 403 }),
    );
  });

  it("rejects the v2 document on a profile that has no v2 document", () => {
    expect(() =>
      resolveMcpPrincipal(CLAIMS, {
        ...ACTIVE_GRANT,
        permissionProfile: "task_manager",
        permissionsVersion: 2,
        permissions: [
          "projects.read",
          "goals.read",
          "tasks.read",
          "tasks.create",
          "tasks.update",
          "today.read",
          "timer.read",
        ],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "PERMISSION_DENIED", status: 403 }),
    );
  });

  it("rejects an invalid permissions version", () => {
    expect(() =>
      resolveMcpPrincipal(CLAIMS, {
        ...ACTIVE_GRANT,
        // Deliberately outside McpPermissionVersion: the point of the case is
        // that an out-of-contract stored value is rejected at runtime, which is
        // only observable by constructing one the type forbids.
        permissionsVersion: 0 as never,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "PERMISSION_DENIED", status: 403 }),
    );
  });

  it.each([
    ["a future version", 3],
    ["a non-integer version", 1.5],
    ["a numeric string version", "1"],
    ["a null version", null],
  ])("fails closed on %s read from the row", (_label, permissionsVersion) => {
    expect(() =>
      resolveMcpPrincipal(CLAIMS, {
        ...ACTIVE_GRANT,
        permissionsVersion: permissionsVersion as never,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "PERMISSION_DENIED", status: 403 }),
    );
  });
});
