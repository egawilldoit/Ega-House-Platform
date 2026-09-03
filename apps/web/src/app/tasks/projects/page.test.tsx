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

const DELETE_FORM_PATH = resolve(
  import.meta.dirname,
  "../../../components/projects/project-permanent-delete-form.tsx",
);

const ACTIONS_PATH = resolve(
  import.meta.dirname,
  "./actions.ts",
);

test("archived project cards wire the permanent-delete form to the delete server action", () => {
  const source = readFileSync(PROJECT_PAGE_PATH, "utf-8");

  assert.match(source, /deleteProjectAction/, "Delete action should use the server action");
  assert.match(
    source,
    /ProjectPermanentDeleteForm/,
    "Archived cards should render the permanent-delete form component",
  );
  assert.match(
    source,
    /project\.taskCount > 0/,
    "Delete affordance must be gated on linked task count",
  );
  assert.match(
    source,
    /Permanent deletion unavailable/,
    "Cards with linked tasks must explain why deletion is unavailable",
  );
});

test("permanent-delete form requires browser confirmation and hidden safeguards", () => {
  const source = readFileSync(DELETE_FORM_PATH, "utf-8");

  assert.match(source, /^"use client";/m, "Confirmation must live in a client component");
  assert.match(source, /window\.confirm\(/, "Submit must ask for explicit confirmation");
  assert.match(source, /Permanently delete/, "Confirmation copy must name the destructive action");
  assert.match(source, /This cannot be undone/, "Confirmation copy must state irreversibility");
  assert.match(source, /event\.preventDefault\(\)/, "Declining confirmation must cancel submit");
  assert.match(
    source,
    /name="confirmDelete" value="true"/,
    "Form must carry the server-checked confirmation safeguard",
  );
  assert.match(source, /name="projectId"/, "Form must carry the project id");
  assert.match(source, /name="returnTo"/, "Form must preserve the return path");
  assert.match(source, /Delete permanently/, "Button label must be unambiguous");
  assert.doesNotMatch(source, />Delete</, "Button must never use the bare Delete label");
});

test("projects server page never touches browser confirmation APIs directly", () => {
  const source = readFileSync(PROJECT_PAGE_PATH, "utf-8");

  assert.doesNotMatch(source, /window\./, "Server Component must not reference window");
  assert.doesNotMatch(source, /document\./, "Server Component must not reference document");
});

test("delete errors render on the originating card only", () => {
  const source = readFileSync(PROJECT_PAGE_PATH, "utf-8");

  assert.match(
    source,
    /projectUpdateField === "delete"/,
    "Delete failures must map to the originating project card",
  );
  assert.match(
    source,
    /projectUpdateProjectId === project\.id/,
    "Errors must stay scoped to one card",
  );
});

test("delete server action enforces confirmation and drops the deleted anchor", () => {
  const source = readFileSync(ACTIONS_PATH, "utf-8");
  const deleteAction = source.slice(source.indexOf("export async function deleteProjectAction"));

  assert.match(deleteAction, /deleteArchivedProject/, "Action must call the application use case");
  assert.match(
    deleteAction,
    /confirmDelete !== "true"/,
    "Action must require the confirmation safeguard",
  );
  assert.match(deleteAction, /redirect\(returnPath\)/, "Success must return to the project view");
  assert.doesNotMatch(
    deleteAction,
    /#project-/,
    "Success redirect must not point at the deleted card anchor",
  );
  assert.doesNotMatch(
    deleteAction,
    /fetch\(/,
    "Server action must compose application/data-access directly, never self-fetch Hono",
  );
});
