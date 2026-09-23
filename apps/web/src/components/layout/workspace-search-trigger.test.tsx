import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkspaceSearchTrigger } from "./workspace-search-trigger";

test("search trigger keeps the canonical palette contract and drawer-safe markup", () => {
  const markup = renderToStaticMarkup(<WorkspaceSearchTrigger />);

  assert.match(markup, /aria-haspopup="dialog"/);
  assert.match(markup, /data-testid="workspace-search-trigger"/);
  assert.match(markup, /Search tasks, goals, and projects/);
});

test("workspace-search-trigger closes the enclosing drawer before opening the palette", async () => {
  // The trigger and the drawer are the two aria-modal surfaces on phone
  // widths; the source must keep the deterministic close-then-open ordering
  // that Create task and Capture already follow.
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const source = readFileSync(
    join(process.cwd(), "src/components/layout/workspace-search-trigger.tsx"),
    "utf8",
  );

  assert.match(source, /useWorkspaceDrawer/);
  const closeIndex = source.indexOf("drawer?.closeDrawer({ restoreFocus: false })");
  const dispatchIndex = source.indexOf("window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_EVENT))");
  assert.ok(closeIndex >= 0, "trigger must close the drawer");
  assert.ok(dispatchIndex > closeIndex, "palette must open only after the drawer is closed");
});
