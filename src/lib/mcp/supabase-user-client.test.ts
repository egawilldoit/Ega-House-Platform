import { describe, expect, it, vi } from "vitest";

import { createMcpSupabaseClient } from "@/lib/mcp/supabase-user-client";

describe("createMcpSupabaseClient", () => {
  it("creates a stateless user client with the caller bearer token", () => {
    const client = { marker: "client" };
    const factory = vi.fn().mockReturnValue(client);

    expect(
      createMcpSupabaseClient("signed-token", {
        supabaseUrl: "https://example.supabase.co",
        publishableKey: "publishable-key",
        factory,
      }),
    ).toBe(client);

    expect(factory).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "publishable-key",
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        global: {
          headers: {
            Authorization: "Bearer signed-token",
          },
        },
      },
    );
  });

  it.each([
    ["supabaseUrl", ""],
    ["publishableKey", ""],
    ["accessToken", ""],
  ])("rejects an empty %s", (field, value) => {
    const factory = vi.fn();
    const input = {
      accessToken: "signed-token",
      supabaseUrl: "https://example.supabase.co",
      publishableKey: "publishable-key",
      [field]: value,
    };

    expect(() =>
      createMcpSupabaseClient(input.accessToken, {
        supabaseUrl: input.supabaseUrl,
        publishableKey: input.publishableKey,
        factory,
      }),
    ).toThrow();
    expect(factory).not.toHaveBeenCalled();
  });
});
