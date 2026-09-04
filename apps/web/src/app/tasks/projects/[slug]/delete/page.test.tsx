import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DELETE_PAGE_PATH = resolve(
  import.meta.dirname,
  "./page.tsx",
);

const ACTIONS_PATH = resolve(
  import.meta.dirname,
  "..",
  "..",
  "actions.ts",
);

test("delete confirmation page shows the exact deletion impact", () => {
  const source = readFileSync(DELETE_PAGE_PATH, "utf-8");

  assert.match(source, /getProjectPurgePreview/, "Page must load the purge preview");
  for (const field of [
    "taskCount",
    "goalCount",
    "sessionCount",
    "activeSessionCount",
    "reminderCount",
    "recurrenceCount",
    "taskNotificationCount",
    "calendarEventCount",
  ]) {
    assert.match(source, new RegExp(field), `Impact must include ${field}`);
  }
  assert.match(
    source,
    /Ideas and saved task views will be preserved but unlinked/,
    "Preservation behavior must be stated",
  );
  assert.match(source, /This cannot be undone/, "Irreversibility must be stated");
});

test("delete confirmation page requires the typed project name", () => {
  const source = readFileSync(DELETE_PAGE_PATH, "utf-8");

  assert.match(source, /purgeProjectAction/, "Form must submit to the purge server action");
  assert.match(source, /name="confirmationName"/, "Form must collect the typed confirmation");
  assert.match(source, /name="expectedTaskCount"/, "Form must carry the previewed task count");
  assert.match(source, /name="expectedGoalCount"/, "Form must carry the previewed goal count");
  assert.match(source, /Purge project permanently/, "Submit must use the unambiguous purge label");
  assert.doesNotMatch(source, /window\.confirm/, "Typed confirmation replaces window.confirm");
  assert.doesNotMatch(source, /window\./, "Server Component must not reference window");
});

test("delete confirmation page guards non-archived and missing projects", () => {
  const source = readFileSync(DELETE_PAGE_PATH, "utf-8");

  assert.match(source, /isProjectArchivedStatus/, "Page must require the archived state");
  assert.match(source, /notFound\(\)/, "Missing projects must render not-found");
  assert.match(source, /purgeError/, "Purge failures must surface on the confirmation page");
});

test("purge action routes failures back to the confirmation page", () => {
  const source = readFileSync(ACTIONS_PATH, "utf-8");

  assert.match(
    source,
    /\/tasks\/projects\/\$\{slug\}\/delete/,
    "Error redirect must target the confirmation page",
  );
});
