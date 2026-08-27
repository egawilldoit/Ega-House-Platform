import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const navigationFile = path.join(
  process.cwd(),
  "src",
  "components",
  "layout",
  "sidebar-navigation.tsx",
);

test("does not render Hermes external link in shared workspace navigation", () => {
  const source = readFileSync(navigationFile, "utf8");

  assert.doesNotMatch(source, /hermes\.egawilldoit\.online/);
  assert.doesNotMatch(source, /href="https:\/\/hermes/);
});
