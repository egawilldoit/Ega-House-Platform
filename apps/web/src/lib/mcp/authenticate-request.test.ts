import { describe, expect, it, vi } from "vitest";

import {
  authenticateMcpRequest,
  extractBearerToken,
} from "@/lib/mcp/authenticate-request";

const ISSUER = "https://example.supabase.co/auth/v1";
const AUDIENCE = "https://ega.example.com/api/mcp";
const NOW = 2_000_000_000;

function createHeaders(authorization?: string): Headers {
  const headers = new Headers();
  if (authorization) headers.set("authorization", authorization);
  return headers;
}

describe("MCP request authentication", () => {
  it("extracts a bearer token from the Authorization header", () => {
    expect(extractBearerToken(createHeaders("Bearer signed-token"))).toBe(
      "signed-token",
    );
  });

  it.each([
    undefined,
    "",
    "Basic credentials",
    "Bearer",
    "Bearer token extra",
  ])("rejects a malformed Authorization header: %s", (authorization) => {
    expect(() => extractBearerToken(createHeaders(authorization))).toThrowError(
      expect.objectContaining({ code: "UNAUTHENTICATED", status: 401 }),
    );
  });

  it("verifies the bearer token before validating identity claims", async () => {
    const verifyAccessToken = vi.fn().mockResolvedValue({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: "00000000-0000-0000-0000-000000000001",
      client_id: "hermes-client",
      exp: NOW + 600,
    });

    await expect(
      authenticateMcpRequest(createHeaders("Bearer signed-token"), {
        issuer: ISSUER,
        audience: AUDIENCE,
        nowSeconds: NOW,
        verifyAccessToken,
      }),
    ).resolves.toEqual({
      accessToken: "signed-token",
      claims: {
        sub: "00000000-0000-0000-0000-000000000001",
        client_id: "hermes-client",
      },
    });

    expect(verifyAccessToken).toHaveBeenCalledWith("signed-token");
  });

  it("normalizes verifier failures to UNAUTHENTICATED", async () => {
    const verifyAccessToken = vi
      .fn()
      .mockRejectedValue(new Error("provider details must not leak"));

    await expect(
      authenticateMcpRequest(createHeaders("Bearer signed-token"), {
        issuer: ISSUER,
        audience: AUDIENCE,
        nowSeconds: NOW,
        verifyAccessToken,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "UNAUTHENTICATED",
        status: 401,
        message: "Access token verification failed.",
      }),
    );
  });

  it("fails closed when a verifier returns malformed claims", async () => {
    const verifyAccessToken = vi.fn().mockResolvedValue(null);

    await expect(
      authenticateMcpRequest(createHeaders("Bearer signed-token"), {
        issuer: ISSUER,
        audience: AUDIENCE,
        nowSeconds: NOW,
        verifyAccessToken,
      }),
    ).rejects.toEqual(expect.objectContaining({
      code: "UNAUTHENTICATED",
      status: 401,
      message: "Access token verification failed.",
    }));
  });
});
