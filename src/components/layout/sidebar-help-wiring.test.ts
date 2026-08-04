import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const routeMetaFile = path.join(
  process.cwd(),
  "src",
  "components",
  "layout",
  "shell-route-meta.ts",
);
const navigationFile = path.join(
  process.cwd(),
  "src",
  "components",
  "layout",
  "sidebar-navigation.tsx",
);

test("shared workspace navigation points Help to the real /help route", () => {
  const routeMeta = readFileSync(routeMetaFile, "utf8");
  const navigation = readFileSync(navigationFile, "utf8");

  assert.match(
    routeMeta,
    /href:\s*"\/help",[\s\S]*?index:\s*"S5",[\s\S]*?label:\s*"Help"/,
  );
  assert.doesNotMatch(
    routeMeta,
    /href:\s*"\/dashboard",[\s\S]*?index:\s*"S5",[\s\S]*?label:\s*"Help"/,
  );
  assert.match(navigation, /SYSTEM_ROUTES\.map/);
  assert.match(navigation, /canonicalUrl\.resolve\(route\.href\)/);
});
