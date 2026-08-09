import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROJECT_PAGE_PATH = resolve(
  import.meta.dirname,
  "./page.tsx",
);

test("projects page no longer contains form action=/tasks/projects/new for New Project navigation", () => {
  const source = readFileSync(PROJECT_PAGE_PATH, "utf-8");

  // The EmptyState component and actions slot should not use <form action="/tasks/projects/new">
  // They should use <Link href="/tasks/projects/new">
  assert.doesNotMatch(
    source,
    /<form[^>]*action="\/tasks\/projects\/new"[^>]*>/,
    "Should not have form-based navigation to /tasks/projects/new",
  );
});

test("projects page uses Link with href=/tasks/projects/new for New Project navigation", () => {
  const source = readFileSync(PROJECT_PAGE_PATH, "utf-8");

  const linkMatches = source.match(/Link[^>]*href="\/tasks\/projects\/new"/g);
  assert.ok(
    linkMatches && linkMatches.length >= 2,
    `Expected at least 2 Link href="/tasks/projects/new" references, found ${linkMatches?.length ?? 0}`,
  );
});

test("projects page imports buttonVariants for Link button styling", () => {
  const source = readFileSync(PROJECT_PAGE_PATH, "utf-8");

  assert.match(
    source,
    /import.*buttonVariants.*from/,
    "Should import buttonVariants for Link styling",
  );

  assert.match(
    source,
    /import.*cn.*from.*\/lib\/utils/,
    "Should import cn for Link className composition",
  );
});

test("projects page still uses form for archive/unarchive actions (data submission)", () => {
  const source = readFileSync(PROJECT_PAGE_PATH, "utf-8");

  // Archive/Unarchive are data-submitting forms, should remain as forms
  assert.match(
    source,
    /archiveProjectAction/,
    "Archive action should still use server action",
  );
  assert.match(
    source,
    /unarchiveProjectAction/,
    "Unarchive action should still use server action",
  );
});
