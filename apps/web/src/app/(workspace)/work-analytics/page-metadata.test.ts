import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const pageFile = path.join(process.cwd(), "src", "app", "work-analytics", "page.tsx");

test("work analytics page exports metadata with the Analytics title", () => {
  const source = readFileSync(pageFile, "utf8");

  assert.match(source, /export const metadata/);
  assert.match(source, /title:\s*"Analytics"/);
});