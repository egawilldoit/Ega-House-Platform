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

const quickTaskSheetSource = readFileSync(
  resolvePathFromImportMeta(
    "./quick-task-sheet.tsx",
    "src/components/tasks/quick-task-sheet.tsx",
  ),
  "utf8",
);

function getSection(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(endIndex, -1, `Missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

const panelSection = getSection(
  quickTaskSheetSource,
  "export function QuickTaskSheetPanel",
  "\n}\n",
);

test("lean quick task capture is a single title input plus one submit", () => {
  assert.match(panelSection, /id="quick-task-command"/);
  assert.match(panelSection, /name="title"/);
  assert.match(panelSection, /label="Create task"/);
  assert.doesNotMatch(panelSection, /TabsContent|activeTab === "multi"/);
  assert.doesNotMatch(panelSection, /createTasksBulkAction|MultiTaskDraft/);
});

test("quick task capture keeps an optional details disclosure for project, due, priority", () => {
  const details = getSection(panelSection, "<details", "</details>");
  assert.match(details, /id="quick-task-project"/);
  assert.match(details, /name="projectId"/);
  assert.match(details, /id="quick-task-due-date"/);
  assert.match(details, /name="dueDate"/);
  assert.match(details, /id="quick-task-priority"/);
  assert.match(details, /name="priority"/);
  assert.match(details, /Details/);
});

test("quick task capture no longer parses command tokens or stages multiple drafts", () => {
  assert.doesNotMatch(quickTaskSheetSource, /parseQuickTaskCommand/);
  assert.doesNotMatch(quickTaskSheetSource, /drafts\.map|readyDraftCount|invalidDraftCount/);
  assert.doesNotMatch(quickTaskSheetSource, /createTasksBulkAction/);
});

test("quick task title is length-bounded and announced", () => {
  assert.match(panelSection, /TASK_TITLE_MAX/);
  assert.match(panelSection, /id="quick-task-title-count"/);
  assert.match(panelSection, /id="quick-task-title-error"/);
  assert.match(panelSection, /aria-invalid=\{titleTooLong\}/);
  assert.match(panelSection, /disabled=\{!title\.trim\(\) \|\| titleTooLong\}/);
});

test("quick task capture focuses the title when opened", () => {
  assert.match(
    quickTaskSheetSource,
    /getElementById\("quick-task-command"\)\?\.focus\(\)/,
  );
});

test("quick task presents an accessible panel title for the shell dialog", () => {
  assert.match(
    quickTaskSheetSource,
    /<DialogPrimitive\.Title[\s\S]+id="quick-task-sheet-title"/,
  );
  assert.match(
    quickTaskSheetSource,
    /<DialogPrimitive\.Description[\s\S]+id="quick-task-sheet-description"/,
  );
});

test("quick task submit carries the required createTaskAction fields", () => {
  assert.match(panelSection, /name="returnTo"/);
  assert.match(panelSection, /name="goalId"/);
  assert.match(panelSection, /name="estimateMinutes"/);
  assert.match(panelSection, /name="status"/);
  assert.match(panelSection, /name="description"/);
});

test("quick task sheets carry no legacy gold tokens or hard-coded whites", () => {
  assert.doesNotMatch(quickTaskSheetSource, /ega-gold/);
  assert.doesNotMatch(quickTaskSheetSource, /bg-white/);
  assert.doesNotMatch(quickTaskSheetSource, /accent-\[rgb\(/);
});
