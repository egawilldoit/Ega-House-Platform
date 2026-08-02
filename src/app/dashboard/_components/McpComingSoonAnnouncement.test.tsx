import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { McpComingSoonAnnouncement } from "./McpComingSoonAnnouncement";

test("renders the persistent MCP coming-soon announcement with safe launch positioning", () => {
  const markup = renderToStaticMarkup(<McpComingSoonAnnouncement />);

  assert.match(markup, /aria-labelledby="mcp-coming-soon-title"/);
  assert.match(markup, /MCP · COMING SOON/);
  assert.match(markup, /Connect your AI to EGA House\./);
  assert.match(markup, /projects, goals, and tasks/);
  assert.match(markup, /OAuth-protected/);
  assert.match(markup, /Owner-scoped access/);
  assert.match(markup, /Read-only at launch/);
  assert.doesNotMatch(markup, /Dismiss/i);
});
