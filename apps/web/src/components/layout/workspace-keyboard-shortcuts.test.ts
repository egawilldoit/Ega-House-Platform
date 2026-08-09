import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const shortcutsFile = path.join(
  process.cwd(),
  "src",
  "components",
  "layout",
  "workspace-keyboard-shortcuts.tsx",
);

test("workspace keyboard shortcuts wire core navigation and quick actions", () => {
  const source = readFileSync(shortcutsFile, "utf8");

  assert.match(source, /openQuickTask:\s*QUICK_TASK_EVENT/);
  assert.match(source, /SHORTCUT_ROUTE_MAP\.apps/);
  assert.match(source, /SHORTCUT_ROUTE_MAP\.timer/);
  assert.match(source, /getShortcutRouteFromSequenceKey/);
  assert.match(source, /shouldOpenShortcutHelp/);
});
