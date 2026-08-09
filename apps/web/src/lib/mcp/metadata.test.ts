import { describe, expect, it } from "vitest";

import {
  buildProtectedResourceMetadata,
  normalizeMcpResourceUrl,
  normalizeSupabaseAuthorizationServer,
} from "@/lib/mcp/metadata";

describe("MCP protected resource metadata", () => {
  it("builds RFC 9728 metadata for one canonical resource", () => {
    expect(
      buildProtectedResourceMetadata({
        resource: "https://ega.example.com/api/mcp",
        authorizationServer: "https://example.supabase.co/auth/v1",
        resourceDocumentation: "https://ega.example.com/integrations/mcp",
      }),
    ).toEqual({
      resource: "https://ega.example.com/api/mcp",
      authorization_servers: ["https://example.supabase.co/auth/v1"],
      bearer_methods_supported: ["header"],
      resource_documentation: "https://ega.example.com/integrations/mcp",
    });
  });

  it("does not advertise EGA permissions as OAuth scopes", () => {
    const metadata = buildProtectedResourceMetadata({
      resource: "https://ega.example.com/api/mcp",
      authorizationServer: "https://example.supabase.co/auth/v1",
    });

    expect(metadata).not.toHaveProperty("scopes_supported");
  });

  it("removes trailing slashes from the canonical MCP resource", () => {
    expect(normalizeMcpResourceUrl("https://ega.example.com/api/mcp/")).toBe(
      "https://ega.example.com/api/mcp",
    );
  });

  it("derives the Supabase authorization-server issuer", () => {
    expect(
      normalizeSupabaseAuthorizationServer("https://example.supabase.co/"),
    ).toBe("https://example.supabase.co/auth/v1");
  });

  it.each([
    "",
    "not-a-url",
    "ftp://ega.example.com/api/mcp",
    "http://ega.example.com/api/mcp",
  ])("rejects an unsafe production resource URL: %s", (value) => {
    expect(() => normalizeMcpResourceUrl(value)).toThrow(
      "MCP resource URL must use HTTPS or localhost HTTP.",
    );
  });

  it("allows localhost HTTP for development", () => {
    expect(normalizeMcpResourceUrl("http://localhost:3000/api/mcp")).toBe(
      "http://localhost:3000/api/mcp",
    );
  });
});
