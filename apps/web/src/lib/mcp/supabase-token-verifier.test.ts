import { describe, expect, it, vi } from "vitest";

import { createSupabaseAccessTokenVerifier } from "@/lib/mcp/supabase-token-verifier";

describe("createSupabaseAccessTokenVerifier", () => {
  it("returns claims verified by Supabase Auth", async () => {
    const getClaims = vi.fn().mockResolvedValue({
      data: {
        claims: {
          iss: "https://example.supabase.co/auth/v1",
          aud: "https://ega.example.com/api/mcp",
          sub: "user-id",
          client_id: "hermes-client",
          exp: 2_000_000_100,
        },
      },
      error: null,
    });

    const verify = createSupabaseAccessTokenVerifier({
      auth: { getClaims },
    });

    await expect(verify("signed-token")).resolves.toEqual(
      expect.objectContaining({
        sub: "user-id",
        client_id: "hermes-client",
      }),
    );
    expect(getClaims).toHaveBeenCalledWith("signed-token");
  });

  it("rejects Supabase verification errors without exposing provider details", async () => {
    const verify = createSupabaseAccessTokenVerifier({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "sensitive provider detail" },
        }),
      },
    });

    await expect(verify("invalid-token")).rejects.toThrow(
      "Supabase access token verification failed.",
    );
  });

  it("rejects a successful response without a claims object", async () => {
    const verify = createSupabaseAccessTokenVerifier({
      auth: {
        getClaims: vi.fn().mockResolvedValue({ data: {}, error: null }),
      },
    });

    await expect(verify("invalid-token")).rejects.toThrow(
      "Supabase access token verification failed.",
    );
  });
});
