import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

function resolvePathFromImportMeta(relativePath: string, fallbackPath: string) {
  try {
    return fileURLToPath(new URL(relativePath, import.meta.url));
  } catch {
    return path.resolve(process.cwd(), fallbackPath);
  }
}

const formSource = readFileSync(resolvePathFromImportMeta(
  "./inline-task-update-form.tsx",
  "src/components/tasks/inline-task-update-form.tsx",
), "utf8");

// The reminder block and the centered editor shell moved from the legacy
// sheet into the "Edit task" modal (task editing redesign); the same layout
// contract is verified against that component now.
const modalSource = readFileSync(resolvePathFromImportMeta(
  "./edit-task-modal.tsx",
  "src/components/tasks/edit-task-modal.tsx",
), "utf8");

function getSection(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing section start: ${start}`);

  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(endIndex, -1, `Missing section end: ${end}`);

  return source.slice(startIndex, endIndex);
}

test("advanced settings caps the form at two responsive columns", () => {
  assert.match(formSource, /@container/);
  assert.match(formSource, /grid grid-cols-1 gap-3 @lg:grid-cols-2/);
  assert.doesNotMatch(formSource, /xl:grid-cols-5|grid-cols-3/);
});

test("advanced settings controls are full width and share the form grammar", () => {
  assert.doesNotMatch(formSource, /ega-glass-input/);
  assert.doesNotMatch(formSource, /ega-glass-soft/);
  assert.doesNotMatch(formSource, /focus:ring-\[rgba\(23,123,82/);
  assert.match(formSource, /className="input-instrument min-h-11 w-full px-3 text-sm"/);
  assert.match(formSource, /className="min-h-11 w-full"/);
});

test("advanced settings groups fields under whitespace section labels", () => {
  for (const group of ["Task", "Schedule", "Calendar"]) {
    assert.match(formSource, new RegExp(`glass-label text-etch">${group}</p>`));
  }
  assert.match(modalSource, /glass-label text-etch"/);
});

test("advanced settings status options use canonical display labels", () => {
  const statusField = getSection(formSource, 'name="status"', "</select>");
  assert.match(statusField, /\{formatDisplayStatus\(statusValue\)\}/);
  assert.doesNotMatch(statusField, /formatTaskToken/);
});

test("advanced settings calendar reminder expresses its unit", () => {
  const reminderField = getSection(
    formSource,
    "id={`task-update-reminder-${taskId}`}",
    "</div>",
  );
  assert.match(reminderField, /minutes before/);
  assert.match(reminderField, /name="calendarReminderMinutes"/);
});

test("advanced settings footer keeps one primary action and hides destructive actions", () => {
  assert.match(formSource, /Save changes/);
  assert.match(formSource, /pendingLabel="Saving\.\.\."/);

  const saveIndex = formSource.indexOf("Save changes");
  const saveButton = formSource.slice(
    formSource.lastIndexOf("<PendingSubmitButton", saveIndex),
    saveIndex + "Save changes".length,
  );
  assert.match(saveButton, /form=\{updateFormId\}/);
  assert.doesNotMatch(saveButton, /variant="danger"/);

  const overflowMenu = getSection(
    formSource,
    'className="action-overflow"',
    "</details>",
  );
  assert.match(overflowMenu, /Archive/);
  assert.match(overflowMenu, /Delete task/);

  const archiveButton = overflowMenu.match(/<Button[\s\S]*?>\s*Archive\s*<\/Button>/);
  assert.notEqual(archiveButton, null);
  assert.match(archiveButton![0], /variant="danger"/);
});

test("edit task modal is a capped, centered, scrolling dialog with a stable footer", () => {
  assert.match(
    modalSource,
    /max-h-\[min\(50rem,calc\(100dvh-2rem\)\)\]/,
  );
  assert.match(modalSource, /max-w-\[53rem\]/);
  assert.match(modalSource, /-translate-x-1\/2 -translate-y-1\/2/);
  assert.match(modalSource, /min-h-0 flex-1 space-y-4 overflow-y-auto/);
  assert.match(modalSource, /shrink-0 border-t border-\[var\(--ega-border\)\]/);
});

test("advanced settings sheets carry no legacy gold tokens", () => {
  assert.doesNotMatch(formSource, /ega-gold|--ega-gold/);
  assert.doesNotMatch(modalSource, /ega-gold|--ega-gold/);
});
