import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const IDEAS_PAGE_PATH = resolve(
  import.meta.dirname,
  "./page.tsx",
);

test("ideas page keeps GET filter form with action=/ideas method=get", () => {
  const source = readFileSync(IDEAS_PAGE_PATH, "utf-8");

  // The ideas filter/search form should remain as GET form (has actual inputs)
  assert.match(
    source,
    /<form[^>]*action="\/ideas"[^>]*method="get"[^>]*>/,
    "Ideas filter form should remain as GET form with action=/ideas",
  );
});

test("ideas page filter form contains search, type, status, project, priority inputs", () => {
  const source = readFileSync(IDEAS_PAGE_PATH, "utf-8");

  assert.match(source, /name="q"/, "Should have search input");
  assert.match(source, /name="type"/, "Should have type select");
  assert.match(source, /name="status"/, "Should have status select");
  assert.match(source, /name="project"/, "Should have project select");
  assert.match(source, /name="priority"/, "Should have priority select");
  assert.match(source, /name="tag"/, "Should have tag input");
});

test("ideas page uses Link for view switches (Active/Archived/All)", () => {
  const source = readFileSync(IDEAS_PAGE_PATH, "utf-8");

  // View switches should use Link, not forms
  assert.match(
    source,
    /Link[^>]*href=\{getIdeaViewHref\("active/,
    "Active view should use Link",
  );
  assert.match(
    source,
    /Link[^>]*href=\{getIdeaViewHref\("archived/,
    "Archived view should use Link",
  );
  assert.match(
    source,
    /Link[^>]*href=\{getIdeaViewHref\("all/,
    "All view should use Link",
  );
});
