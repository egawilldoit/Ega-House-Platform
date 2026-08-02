import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { McpComingSoonAnnouncement } from "./McpComingSoonAnnouncement";

test("renders the premium MCP coming-soon announcement without implying live access", () => {
  const markup = renderToStaticMarkup(<McpComingSoonAnnouncement />);

  assert.match(markup, /aria-labelledby="mcp-coming-soon-title"/);
  assert.match(markup, /NEW IN EGA HOUSE/);
  assert.match(markup, /Coming soon/);
  assert.match(markup, /Your workspace is about to become AI-connected\./);
  assert.match(markup, /Approved AI tools will soon be able to read your projects, goals, and tasks directly\./);
  assert.match(markup, /Nothing changes until you choose to connect one\./);
  assert.match(markup, /role="img"/);
  assert.match(markup, /AI clients/);
  assert.match(markup, /Secure gateway/);
  assert.match(markup, /Projects · Goals · Tasks/);
  assert.match(markup, /OAuth protected/);
  assert.match(markup, /Scoped to your account/);
  assert.match(markup, /Read-only first release/);
  assert.doesNotMatch(markup, /<button/);
  assert.doesNotMatch(markup, /href=/);
  assert.doesNotMatch(markup, /Connect your AI to EGA House/);
  assert.doesNotMatch(markup, /Dismiss/i);
});

test("keeps the connector motion scoped and reduced-motion safe", () => {
  const styles = readFileSync(new URL("./dashboard.css", import.meta.url), "utf8");

  assert.match(styles, /@keyframes mcp-signal-travel/);
  assert.match(styles, /\.mcp-connector-signal/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
