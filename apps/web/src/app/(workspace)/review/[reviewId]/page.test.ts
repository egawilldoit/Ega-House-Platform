import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PAGE_PATH = resolve(import.meta.dirname, "./page.tsx");

test("review detail threads its time context into Created/Updated timestamps", () => {
  const source = readFileSync(PAGE_PATH, "utf-8");

  assert.match(source, /getWebTimeContext/, "page must resolve the web time context");
  assert.match(
    source,
    /formatDateTime\(review\.created_at, reviewTimezone\)/,
    "Created timestamp must receive the resolved timezone",
  );
  assert.match(
    source,
    /formatDateTime\(review\.updated_at, reviewTimezone\)/,
    "Updated timestamp must receive the resolved timezone",
  );
});
