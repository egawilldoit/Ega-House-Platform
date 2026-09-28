import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const IDEAS_PAGE_PATH = resolve(
  import.meta.dirname,
  "./page.tsx",
);

test("EGA-659: /ideas page is now a compatibility redirect, not a triage console", () => {
  const source = readFileSync(IDEAS_PAGE_PATH, "utf-8");

  assert.match(source, /redirect\(/);
  assert.match(source, /\/backlog/);
  assert.doesNotMatch(source, /action="\/ideas"/);
  assert.doesNotMatch(source, /method="get"/);
  assert.doesNotMatch(source, /name="q"/);
  assert.doesNotMatch(source, /name="type"/);
  assert.doesNotMatch(source, /name="status"/);
  assert.doesNotMatch(source, /name="priority"/);
  assert.doesNotMatch(source, /name="tag"/);
  assert.doesNotMatch(source, /FilterPill/);
  assert.doesNotMatch(source, /PendingSubmitButton/);
});
