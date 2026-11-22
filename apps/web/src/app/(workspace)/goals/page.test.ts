import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("Goals keeps a real page and links back to the owning Projects surface", () => {
  const pagePath = resolve(import.meta.dirname, "./page.tsx");
  assert.equal(existsSync(pagePath), true);
  const source = readFileSync(pagePath, "utf8");

  assert.match(source, /href="\/tasks\/projects"/);
  assert.match(source, /CanonicalLink/, "cross-workspace links must resolve on the canonical host");
  assert.match(source, /export default async function GoalsPage/);

  const nextConfig = readFileSync(resolve(process.cwd(), "next.config.ts"), "utf8");
  assert.doesNotMatch(nextConfig, /source:\s*"\/goals"/);
});
