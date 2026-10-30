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
  permissions: ["projects.read", "goals.read", "tasks.read", "today.read", "timer.read"],
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
        "today.read",
        "timer.read",
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

/**
 * This adapter used to conjoin `isValidMcpPrincipal` with a second, weaker
 * structural pre-check. Every rejection below was previously attributable to one
 * or the other, and the whole point of deleting the weaker one is that
 * `isValidMcpPrincipal` alone must still refuse all of them - so each case is
 * pinned here against the single remaining validator, including the malformed
 * shapes that only the structural check used to catch.
 */
describe("readPrincipalFromAuthInfo rejects every principal outside its document", () => {
  const readWith = (principal: unknown): McpPrincipal =>
    readPrincipalFromAuthInfo({
      token: "signed-token",
      clientId: "hermes-client",
      scopes: [MCP_AUTHORIZED_SCOPE, ...PRINCIPAL.permissions],
      extra: { principal },
    });

  it.each([
    ["an unknown profile", { ...PRINCIPAL, permissionProfile: "administrator" }],
    ["the retired delivery_observer profile", { ...PRINCIPAL, permissionProfile: "delivery_observer" }],
    ["an unknown version", { ...PRINCIPAL, permissionsVersion: 3 }],
    ["a version below one", { ...PRINCIPAL, permissionsVersion: 0 }],
    ["a non-integer version", { ...PRINCIPAL, permissionsVersion: 1.5 }],
    ["a numeric string version", { ...PRINCIPAL, permissionsVersion: "1" }],
    ["a permission outside the declared universe", { ...PRINCIPAL, permissions: [...PRINCIPAL.permissions, "not.a.permission"] }],
    ["a permission outside the profile's own document", { ...PRINCIPAL, permissions: [...PRINCIPAL.permissions, "tasks.create"] }],
    ["a permission missing from the document", { ...PRINCIPAL, permissions: PRINCIPAL.permissions.slice(1) }],
    ["a duplicated permission", { ...PRINCIPAL, permissions: [...PRINCIPAL.permissions, "timer.read"] }],
    ["an empty permission array", { ...PRINCIPAL, permissions: [] }],
    ["permissions that are not an array", { ...PRINCIPAL, permissions: "projects.read" }],
    ["a blank owner id", { ...PRINCIPAL, ownerUserId: " " }],
    ["a blank client id", { ...PRINCIPAL, oauthClientId: "" }],
    ["a blank grant id", { ...PRINCIPAL, grantId: "" }],
    ["a missing grant id", { ...PRINCIPAL, grantId: undefined }],
    ["a non-object principal", "not-a-principal"],
    ["a null principal", null],
    ["an array principal", [PRINCIPAL]],
  ])("refuses %s", (label, principal) => {
    expect(readWith, label).toThrow("Missing EGA MCP principal in auth context.");
  });

  it("accepts the same document declared in a different order", () => {
    // Accepted, and returned as the AuthInfo carried it: this adapter validates
    // membership, it does not re-derive the document. Order is not semantic
    // anywhere downstream either - requireMcpPermission and discovery both test
    // membership - so a reordered grant authorises exactly what the canonical
    // order would.
    const reordered = [...PRINCIPAL.permissions].reverse();
    const accepted = readWith({ ...PRINCIPAL, permissions: reordered });

    expect(accepted.permissions).toEqual(reordered);
    expect([...accepted.permissions].sort()).toEqual(
      [...PRINCIPAL.permissions].sort(),
    );
  });

  it("accepts a v2 principal against its own frozen document", () => {
    const v2: McpPrincipal = {
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

    expect(readWith(v2)).toEqual(v2);
  });
});
