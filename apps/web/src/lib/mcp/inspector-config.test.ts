import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("MCP Inspector launcher", () => {
  it("pins the canonical production server to modern protocol mode", () => {
    const root = resolve(process.cwd(), "..", "..");
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const config = JSON.parse(readFileSync(resolve(root, "tools/mcp/inspector.json"), "utf8")) as {
      mcpServers?: Record<string, { type?: string; url?: string; protocolEra?: string }>;
    };
    const server = config.mcpServers?.["ega-house"];

    expect(packageJson.scripts?.["mcp:inspect"]).toBe(
      "npx --yes @modelcontextprotocol/inspector@2.4.0 --config tools/mcp/inspector.json",
    );
    expect(server).toEqual({
      type: "streamable-http",
      url: "https://www.egawilldoit.online/api/mcp",
      protocolEra: "modern",
    });
  });
});
