import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const quickTaskSheetSource = readFileSync(
  fileURLToPath(new URL("./quick-task-sheet.tsx", import.meta.url)),
  "utf8",
);

const taskActionsSource = readFileSync(
  fileURLToPath(new URL("../../app/tasks/actions.ts", import.meta.url)),
  "utf8",
);

function getSection(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing section start: ${start}`);

  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(endIndex, -1, `Missing section end: ${end}`);

  return source.slice(startIndex, endIndex);
}

const singleModeSection = getSection(
  quickTaskSheetSource,
  '<TabsContent value="single"',
  '<TabsContent value="multi"',
);

const multiModeSection = quickTaskSheetSource.slice(
  quickTaskSheetSource.indexOf('<TabsContent value="multi"'),
);

test('quick task single mode renders "Already worked on this?" worked-time fields', () => {
  assert.match(singleModeSection, /Already worked on this\?/);
  assert.match(singleModeSection, /htmlFor="quick-task-worked-from"/);
  assert.match(singleModeSection, /htmlFor="quick-task-worked-to"/);
  assert.match(singleModeSection, />\s*From\s*</);
  assert.match(singleModeSection, />\s*To\s*</);
});

test("quick task worked-time From and To fields submit values", () => {
  assert.match(singleModeSection, /name="workedTimeStartedAt"/);
  assert.match(singleModeSection, /name="workedTimeEndedAt"/);
  assert.match(singleModeSection, /type="datetime-local"/);
  assert.match(taskActionsSource, /formData\.get\("workedTimeStartedAt"\)/);
  assert.match(taskActionsSource, /formData\.get\("workedTimeEndedAt"\)/);
});

test("quick task worked-time values are preserved after server validation errors", () => {
  assert.match(
    singleModeSection,
    /defaultValue=\{singleState\.values\.workedTimeStartedAt\}/,
  );
  assert.match(
    singleModeSection,
    /defaultValue=\{singleState\.values\.workedTimeEndedAt\}/,
  );
  assert.match(taskActionsSource, /workedTimeStartedAt,\s*workedTimeEndedAt,\s*returnTo,/);
  assert.match(taskActionsSource, /return createErrorState\("Task title is required\.", values\)/);
});

test("quick task single mode uses command input with parsed preview and hidden title submit", () => {
  assert.match(singleModeSection, /id="quick-task-command"/);
  assert.match(quickTaskSheetSource, /parseQuickTaskCommand/);
  assert.match(singleModeSection, /Parsed preview/);
  assert.match(singleModeSection, /name="title"\s+value=\{parsedSingleCommand\.title\}/);
  assert.match(singleModeSection, /parsedSingleCommand\.projectError/);
});

test("quick task single mode passes goals and selected project context into command parser", () => {
  assert.match(
    quickTaskSheetSource,
    /parseQuickTaskCommand\(singleCommand,\s*projects,\s*goals,\s*\{\s*selectedProjectId: singleProjectId,\s*\}\)/,
  );
});

test("quick task parsed preview includes goal status and blocked reason", () => {
  assert.match(singleModeSection, />Goal:<\/span>/);
  assert.match(singleModeSection, /parsedSingleCommand\.goalName \?\? selectedGoalName/);
  assert.match(singleModeSection, />Status:<\/span>/);
  assert.match(singleModeSection, /formatTaskToken\(singleStatus\)/);
  assert.match(singleModeSection, />\s*Blocked reason:\s*<\/span>/);
  assert.match(singleModeSection, /singleBlockedReason \|\| "Required"/);
});

test("quick task command errors include goal and blocked errors", () => {
  assert.match(
    quickTaskSheetSource,
    /Boolean\(parsedSingleCommand\.projectError\)[\s\S]+Boolean\(parsedSingleCommand\.goalError\)[\s\S]+Boolean\(parsedSingleCommand\.blockedError\)/,
  );
  assert.match(singleModeSection, /parsedSingleCommand\.goalError/);
  assert.match(singleModeSection, /parsedSingleCommand\.blockedError/);
  assert.match(singleModeSection, /disabled=\{isSinglePending \|\| hasCommandError\}/);
  assert.match(singleModeSection, /if \(hasCommandError\)/);
});

test("quick task blocked reason field is controlled and submits", () => {
  assert.match(quickTaskSheetSource, /const \[singleBlockedReason, setSingleBlockedReason\]/);
  assert.match(singleModeSection, /name="blockedReason"/);
  assert.match(singleModeSection, /value=\{singleBlockedReason\}/);
  assert.match(
    singleModeSection,
    /onChange=\{\(event\) => setSingleBlockedReason\(event\.target\.value\)\}/,
  );
});

test("quick task panel focuses command input when opened", () => {
  assert.match(quickTaskSheetSource, /getElementById\("quick-task-command"\)\?\.focus\(\)/);
  assert.match(quickTaskSheetSource, /workspaceShortcutEvents\.openQuickTask/);
});

test("quick task multi mode does not render worked-time UI", () => {
  assert.doesNotMatch(multiModeSection, /Already worked on this\?/);
  assert.doesNotMatch(multiModeSection, /quick-task-worked-from/);
  assert.doesNotMatch(multiModeSection, /quick-task-worked-to/);
  assert.doesNotMatch(multiModeSection, /name="workedTimeStartedAt"/);
  assert.doesNotMatch(multiModeSection, /name="workedTimeEndedAt"/);
});
