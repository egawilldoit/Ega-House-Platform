import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { McpComingSoonAnnouncement } from "./McpComingSoonAnnouncement";

describe("McpComingSoonAnnouncement", () => {
  it("renders the premium MCP coming-soon announcement without implying live access", () => {
    const markup = renderToStaticMarkup(createElement(McpComingSoonAnnouncement));

    expect(markup).toMatch(/aria-labelledby="mcp-coming-soon-title"/);
    expect(markup).toMatch(/NEW IN EGA HOUSE/);
    expect(markup).toMatch(/Coming soon/);
    expect(markup).toMatch(/Your workspace is about to become AI-connected\./);
    expect(markup).toMatch(
      /Approved AI tools will soon be able to read your projects, goals, and tasks directly\./,
    );
    expect(markup).toMatch(/Nothing changes until you choose to connect one\./);
    expect(markup).toMatch(/role="img"/);
    expect(markup).toMatch(/AI clients/);
    expect(markup).toMatch(/Secure gateway/);
    expect(markup).toMatch(/Projects · Goals · Tasks/);
    expect(markup).toMatch(/OAuth protected/);
    expect(markup).toMatch(/Scoped to your account/);
    expect(markup).toMatch(/Read-only first release/);
    expect(markup).toMatch(/<ul[^>]+aria-label="Connection safeguards"/);
    expect(markup.match(/mcp-connector-signal/g)?.length ?? 0).toBe(1);
    expect(markup).not.toMatch(/<button/);
    expect(markup).not.toMatch(/href=/);
    expect(markup).not.toMatch(/Connect your AI to EGA House/);
    expect(markup).not.toMatch(/Dismiss/i);
  });

  it("keeps the connector motion scoped and reduced-motion safe", () => {
    const styles = readFileSync(new URL("./dashboard.css", import.meta.url), "utf8");

    expect(styles).toMatch(/@keyframes mcp-signal-travel/);
    expect(styles).toMatch(/\.mcp-connector-signal/);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});
