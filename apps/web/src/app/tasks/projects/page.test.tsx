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

const ACTIONS_PATH = resolve(
  import.meta.dirname,
  "./actions.ts",
);

test("archived project cards link every project to the purge confirmation page", () => {
  const source = readFileSync(PROJECT_PAGE_PATH, "utf-8");

  assert.match(
    source,
    /\/tasks\/projects\/\$\{project\.slug\}\/delete/,
    "Archived cards must link to the dedicated delete confirmation page",
  );
  assert.match(
    source,
    /Delete permanently/,
    "Delete link must use the unambiguous destructive label",
  );
  assert.doesNotMatch(
    source,
    /Permanent deletion unavailable/,
    "The linked-tasks product restriction must be gone",
  );
  assert.doesNotMatch(
    source,
    /ProjectPermanentDeleteForm/,
    "The retired inline delete form must have no callers",
  );
});

test("projects server page never touches browser confirmation APIs directly", () => {
  const source = readFileSync(PROJECT_PAGE_PATH, "utf-8");

  assert.doesNotMatch(source, /window\./, "Server Component must not reference window");
  assert.doesNotMatch(source, /document\./, "Server Component must not reference document");
});

test("purge server action validates input and drops the deleted anchor", () => {
  const source = readFileSync(ACTIONS_PATH, "utf-8");
  const purgeAction = source.slice(source.indexOf("export async function purgeProjectAction"));

  assert.match(purgeAction, /purgeArchivedProject/, "Action must call the application use case");
  assert.match(
    purgeAction,
    /redirectWithPurgeError/,
    "Failures must return to the confirmation page",
  );
  assert.match(purgeAction, /revalidateWorkspaceFor/, "Success must revalidate the workspace");
  assert.match(purgeAction, /redirect\(returnPath\)/, "Success must return to the project view");
  assert.doesNotMatch(
    purgeAction,
    /#project-/,
    "Success redirect must not point at the deleted card anchor",
  );
  assert.doesNotMatch(
    purgeAction,
    /fetch\(/,
    "Server action must compose application/data-access directly, never self-fetch Hono",
  );
});
