import type { AuthInfo } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import {
  createMcpHandlerTokenVerifier,
  type McpRuntimeAuthDependencies,
} from "@/lib/mcp/runtime-auth";

const CONFIG = {
  enabled: true,
  writesEnabled: false,
  resource: "https://ega.example.com/api/mcp",
  issuer: "https://example.supabase.co/auth/v1",
  supabaseUrl: "https://example.supabase.co",
  publishableKey: "publishable-key",
};

describe("createMcpHandlerTokenVerifier", () => {
  it("builds provider and user clients from the runtime configuration", async () => {
    const verifierClient = { marker: "verifier" } as unknown as SupabaseClient<McpDatabase>;
    const userClient = { marker: "user" } as unknown as SupabaseClient<McpDatabase>;
    const verifyAccessToken = vi.fn();
    const expected: AuthInfo = {
      token: "signed-token",
      clientId: "hermes-client",
      scopes: ["ega.mcp.authorized"],
    };
    const dependencies: McpRuntimeAuthDependencies = {
      createVerifierClient: vi.fn().mockReturnValue(verifierClient),
      createAccessTokenVerifier: vi.fn().mockReturnValue(verifyAccessToken),
      createUserClient: vi.fn().mockReturnValue(userClient),
      loadGrant: vi.fn(),
      verifyHandlerToken: vi.fn().mockResolvedValue(expected),
    };

    const verifyToken = createMcpHandlerTokenVerifier(CONFIG, dependencies);

    await expect(
      verifyToken(new Request(CONFIG.resource), "signed-token"),
    ).resolves.toBe(expected);
    expect(dependencies.createVerifierClient).toHaveBeenCalledWith(
      CONFIG.supabaseUrl,
      CONFIG.publishableKey,
    );
    expect(dependencies.createAccessTokenVerifier).toHaveBeenCalledWith(
      verifierClient,
    );
    expect(dependencies.verifyHandlerToken).toHaveBeenCalledWith(
      "signed-token",
      expect.objectContaining({
        issuer: CONFIG.issuer,
        audience: CONFIG.resource,
        verifyAccessToken,
        loadGrant: dependencies.loadGrant,
      }),
    );

    const handlerDependencies = vi.mocked(dependencies.verifyHandlerToken)
      .mock.calls[0]?.[1];
    expect(handlerDependencies).toBeDefined();
    expect(handlerDependencies!.createUserClient("signed-token")).toBe(userClient);
    expect(dependencies.createUserClient).toHaveBeenCalledWith(
      "signed-token",
      {
        supabaseUrl: CONFIG.supabaseUrl,
        publishableKey: CONFIG.publishableKey,
      },
    );
  });

  it("does not build a user client until the token path requests one", async () => {
    const dependencies: McpRuntimeAuthDependencies = {
      createVerifierClient: vi.fn().mockReturnValue({}),
      createAccessTokenVerifier: vi.fn().mockReturnValue(vi.fn()),
      createUserClient: vi.fn(),
      loadGrant: vi.fn(),
      verifyHandlerToken: vi.fn().mockResolvedValue(undefined),
    };

    const verifyToken = createMcpHandlerTokenVerifier(CONFIG, dependencies);
    await verifyToken(new Request(CONFIG.resource), undefined);

    expect(dependencies.createUserClient).not.toHaveBeenCalled();
  });
});
