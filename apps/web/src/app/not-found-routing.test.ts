import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function read(...segments: string[]) {
  return readFileSync(path.join(process.cwd(), "src", ...segments), "utf8");
}

test("EGA-708: root not-found renders in app shell and links home", () => {
  const notFound = read("app", "not-found.tsx");
  assert.match(notFound, /import\s+\{\s*AppShell\s*\}\s+from\s+"@\/components\/layout\/app-shell"/);
  assert.match(notFound, /href="\/home"/);
  assert.match(notFound, /title:\s*"Not found"/);
});
