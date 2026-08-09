import { describe, expect, it } from "vitest";

import {
  createMcpAuthInfo,
  MCP_AUTHORIZED_SCOPE,
  readPrincipalFromAuthInfo,
} from "@/lib/mcp/auth-info";
import type { McpPrincipal } from "@/lib/mcp/principal";

const PRINCIPAL: McpPrincipal = {
  ownerUserId: "00000000-0000-0000-0000-000000000001",
  oauthClientId: "hermes-client",
  grantId: "10000000-0000-0000-0000-000000000001",
  permissionProfile: "read_only",
  permissionsVersion: 1,
  permissions: ["projects.read", "goals.read", "tasks.read"],
};

describe("MCP AuthInfo adapter", () => {
  it("carries the verified token, client, authorization marker, permissions, and principal", () => {
    const authInfo = createMcpAuthInfo("signed-token", PRINCIPAL, 2_000_000_100);

    expect(authInfo).toEqual({
      token: "signed-token",
      clientId: "hermes-client",
      scopes: [
        MCP_AUTHORIZED_SCOPE,
        "projects.read",
        "goals.read",
        "tasks.read",
      ],
      expiresAt: 2_000_000_100,
      extra: { principal: PRINCIPAL },
    });
    expect(readPrincipalFromAuthInfo(authInfo)).toEqual(PRINCIPAL);
  });

  it("rejects auth info without a valid EGA principal", () => {
    expect(() =>
      readPrincipalFromAuthInfo({
        token: "signed-token",
        clientId: "hermes-client",
        scopes: [],
        extra: {},
      }),
    ).toThrow("Missing EGA MCP principal in auth context.");
  });

  it("returns defensive permission copies", () => {
    const authInfo = createMcpAuthInfo("signed-token", PRINCIPAL);
    authInfo.scopes.push("tasks.create");

    expect(readPrincipalFromAuthInfo(authInfo).permissions).not.toContain(
      "tasks.create",
    );
  });
});
