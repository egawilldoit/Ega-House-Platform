import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/.well-known/oauth-protected-resource/route";

const ORIGINAL_ENV = process.env;

describe("OAuth protected resource discovery route", () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      MCP_RESOURCE_URL: "https://ega.example.com/api/mcp",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      MCP_RESOURCE_DOCUMENTATION_URL:
        "https://ega.example.com/integrations/mcp",
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns RFC 9728 metadata and cache headers", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300, stale-while-revalidate=300",
    );
    await expect(response.json()).resolves.toEqual({
      resource: "https://ega.example.com/api/mcp",
      authorization_servers: ["https://example.supabase.co/auth/v1"],
      bearer_methods_supported: ["header"],
      resource_documentation: "https://ega.example.com/integrations/mcp",
    });
  });

  it.each(["MCP_RESOURCE_URL", "NEXT_PUBLIC_SUPABASE_URL"] as const)(
    "fails closed when %s is missing",
    async (envName) => {
      delete process.env[envName];

      await expect(GET()).rejects.toThrow(`Missing env.${envName}`);
    },
  );
});
