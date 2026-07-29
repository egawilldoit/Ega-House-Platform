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
  status: "active",
  permissionProfile: "read_only",
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
      permissions: ["projects.read", "goals.read", "tasks.read"],
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

  it("rejects an invalid permissions version", () => {
    expect(() =>
      resolveMcpPrincipal(CLAIMS, {
        ...ACTIVE_GRANT,
        permissionsVersion: 0,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "PERMISSION_DENIED", status: 403 }),
    );
  });
});
