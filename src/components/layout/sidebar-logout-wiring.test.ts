import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const sidebarFile = path.join(process.cwd(), "src", "components", "layout", "sidebar.tsx");

test("sidebar general section wires real logout control and removes fake /login link", () => {
  const source = readFileSync(sidebarFile, "utf8");

  assert.match(source, /import\s+\{\s*SidebarLogout\s*\}\s+from\s+"\.\/sidebar-logout"/);
  assert.match(source, /<SidebarLogout\s*\/>/);
  assert.doesNotMatch(source, /href:\s*"\/login"/);
});
