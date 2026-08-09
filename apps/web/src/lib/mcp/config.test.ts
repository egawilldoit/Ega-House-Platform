import { describe, expect, it } from "vitest";

import { getMcpRuntimeConfig } from "@/lib/mcp/config";

const ENV = {
  MCP_ENABLED: "true",
  MCP_WRITES_ENABLED: "false",
  MCP_RESOURCE_URL: "https://ega.example.com/api/mcp/",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co/",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
};

describe("getMcpRuntimeConfig", () => {
  it("normalizes the resource and issuer with writes disabled", () => {
    expect(getMcpRuntimeConfig(ENV)).toEqual({
      enabled: true,
      writesEnabled: false,
      resource: "https://ega.example.com/api/mcp",
      issuer: "https://example.supabase.co/auth/v1",
      supabaseUrl: "https://example.supabase.co/",
      publishableKey: "publishable-key",
    });
  });

  it("keeps writes disabled when the MCP endpoint is disabled", () => {
    expect(
      getMcpRuntimeConfig({
        ...ENV,
        MCP_ENABLED: "false",
        MCP_WRITES_ENABLED: "true",
      }),
    ).toEqual(expect.objectContaining({ enabled: false, writesEnabled: false }));
  });

  it.each([
    "MCP_RESOURCE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ] as const)("fails closed when %s is absent", (name) => {
    const env = { ...ENV };
    delete env[name];

    expect(() => getMcpRuntimeConfig(env)).toThrow(`Missing env.${name}`);
  });

  it.each(["1", "yes", "TRUE ", "enabled"])(
    "does not enable a flag from ambiguous value %s",
    (value) => {
      expect(
        getMcpRuntimeConfig({ ...ENV, MCP_ENABLED: value }),
      ).toEqual(expect.objectContaining({ enabled: false }));
    },
  );
});
