import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const sidebarFile = path.join(process.cwd(), "src", "components", "layout", "sidebar.tsx");

test("sidebar general section points Help to the real /help route", () => {
  const source = readFileSync(sidebarFile, "utf8");

  assert.match(
    source,
    /\{\s*href:\s*"\/help"\s+as\s+`\/\$\{string\}`,\s*label:\s*"Help"/,
  );
  assert.doesNotMatch(
    source,
    /\{\s*href:\s*"\/dashboard"\s+as\s+`\/\$\{string\}`,\s*label:\s*"Help"/,
  );
});
