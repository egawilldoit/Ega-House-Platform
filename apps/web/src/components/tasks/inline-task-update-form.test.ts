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

const sheetSource = readFileSync(resolvePathFromImportMeta(
  "./task-card-actions.tsx",
  "src/components/tasks/task-card-actions.tsx",
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
  assert.match(sheetSource, /glass-label text-etch">Reminder<\/p>/);
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

test("advanced settings sheet fits its content and pins the footer", () => {
  assert.match(
    sheetSource,
    /h-fit max-h-\[min\(50rem,calc\(100dvh-2rem\)\)\]/,
  );
  assert.match(sheetSource, /min-\[761px\]:w-\[calc\(100%-var\(--sidebar-width\)\)\]/);
  assert.match(sheetSource, /min-h-0 flex-1 space-y-5 overflow-y-auto/);
  assert.match(sheetSource, /stickyFooter/);
  assert.match(formSource, /sticky bottom-0 z-10 -mx-5/);
  assert.match(formSource, /stickyFooter\s*\?\s*"sticky bottom-0/);
});

test("advanced settings sheets carry no legacy gold tokens", () => {
  assert.doesNotMatch(formSource, /ega-gold|--ega-gold/);
  assert.doesNotMatch(sheetSource, /ega-gold|--ega-gold/);
});
