import { describe, expect, it } from "vitest";

import {
  validateMcpAccessTokenClaims,
  type McpAccessTokenClaims,
} from "@/lib/mcp/token-claims";

const NOW = 2_000_000_000;
const EXPECTED = {
  issuer: "https://example.supabase.co/auth/v1",
  audience: "https://ega.example.com/api/mcp",
  nowSeconds: NOW,
};

const VALID_CLAIMS: McpAccessTokenClaims = {
  iss: EXPECTED.issuer,
  aud: EXPECTED.audience,
  sub: "00000000-0000-0000-0000-000000000001",
  client_id: "hermes-client",
  exp: NOW + 3600,
  nbf: NOW - 30,
};

describe("validateMcpAccessTokenClaims", () => {
  it("returns normalized identity claims for a valid token", () => {
    expect(validateMcpAccessTokenClaims(VALID_CLAIMS, EXPECTED)).toEqual({
      sub: VALID_CLAIMS.sub,
      client_id: VALID_CLAIMS.client_id,
    });
  });

  it("accepts an audience array containing the canonical MCP resource", () => {
    expect(
      validateMcpAccessTokenClaims(
        { ...VALID_CLAIMS, aud: ["authenticated", EXPECTED.audience] },
        EXPECTED,
      ),
    ).toEqual({
      sub: VALID_CLAIMS.sub,
      client_id: VALID_CLAIMS.client_id,
    });
  });

  it.each([
    ["wrong issuer", { iss: "https://attacker.example/auth/v1" }],
    ["wrong audience", { aud: "authenticated" }],
    ["expired", { exp: NOW }],
    ["not active", { nbf: NOW + 1 }],
    ["missing subject", { sub: undefined }],
    ["missing client", { client_id: undefined }],
  ])("rejects a token with %s", (_label, override) => {
    expect(() =>
      validateMcpAccessTokenClaims(
        { ...VALID_CLAIMS, ...override },
        EXPECTED,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "UNAUTHENTICATED",
        status: 401,
      }),
    );
  });

  it("requires an expiration claim", () => {
    const { exp: _exp, ...withoutExpiration } = VALID_CLAIMS;

    expect(() =>
      validateMcpAccessTokenClaims(withoutExpiration, EXPECTED),
    ).toThrowError(
      expect.objectContaining({ code: "UNAUTHENTICATED", status: 401 }),
    );
  });
});
