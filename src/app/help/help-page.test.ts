import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const helpPageFile = path.join(process.cwd(), "src", "app", "help", "page.tsx");

test("help page defines metadata and required operational sections", () => {
  const source = readFileSync(helpPageFile, "utf8");

  assert.match(source, /title:\s*"Help"/);
  assert.match(source, /title="Help Center"/);
  assert.match(source, /Getting Started/);
  assert.match(source, /Shortcuts/);
  assert.match(source, /Workflow Guides/);
  assert.match(source, /FAQ/);
  assert.match(source, /\/dashboard/);
  assert.match(source, /\/tasks/);
  assert.match(source, /\/goals/);
  assert.match(source, /\/timer/);
  assert.match(source, /\/review/);
});
