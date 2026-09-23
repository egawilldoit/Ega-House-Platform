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

const quickTaskSheetSource = readFileSync(resolvePathFromImportMeta(
  "./quick-task-sheet.tsx",
  "src/components/tasks/quick-task-sheet.tsx",
), "utf8");

const taskActionsSource = readFileSync(resolvePathFromImportMeta(
  "../../app/tasks/actions.ts",
  "src/app/tasks/actions.ts",
), "utf8");

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

test("quick task single mode renders schedule and calendar sync controls", () => {
  assert.match(singleModeSection, /Calendar handoff/);
  assert.match(singleModeSection, /CalendarClock/);
  assert.match(singleModeSection, /BellRing/);
  assert.match(singleModeSection, /htmlFor="quick-task-scheduled-from"/);
  assert.match(singleModeSection, /htmlFor="quick-task-scheduled-to"/);
  assert.match(singleModeSection, /name="scheduledStartAt"/);
  assert.match(singleModeSection, /name="scheduledEndAt"/);
  assert.match(singleModeSection, /name="scheduleTimezoneOffsetMinutes"/);
  assert.match(singleModeSection, /name="calendarSyncEnabled"/);
  assert.match(singleModeSection, /name="calendarReminderMinutes"/);
  assert.match(singleModeSection, /Sync to Calendar/);
  assert.match(taskActionsSource, /formData\.get\("scheduledStartAt"\)/);
  assert.match(taskActionsSource, /formData\.get\("scheduledEndAt"\)/);
  assert.match(taskActionsSource, /formData\.get\("calendarReminderMinutes"\)/);
});

test("quick task schedule and calendar values are preserved after validation errors", () => {
  assert.match(
    singleModeSection,
    /defaultValue=\{singleState\.values\.scheduledStartAt\}/,
  );
  assert.match(
    singleModeSection,
    /defaultValue=\{singleState\.values\.scheduledEndAt\}/,
  );
  assert.match(
    singleModeSection,
    /defaultChecked=\{singleState\.values\.calendarSyncEnabled === "on"\}/,
  );
  assert.match(
    singleModeSection,
    /defaultValue=\{singleState\.values\.calendarReminderMinutes\}/,
  );
});

test("quick task calendar-enabled creates trigger an immediate queue drain", () => {
  assert.match(taskActionsSource, /import \{ after \} from "next\/server"/);
  assert.match(taskActionsSource, /processPendingCalendarSyncJobs/);
  assert.match(taskActionsSource, /getSupabaseServiceClient/);
  assert.match(taskActionsSource, /drainCalendarSyncQueueAfterResponse/);
  assert.match(
    taskActionsSource,
    /calendarSyncEnabled &&[\s\S]+scheduleResult\.scheduledStartAtIso[\s\S]+scheduleResult\.scheduledEndAtIso/,
  );
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
  assert.match(singleModeSection, /aria-label="Parsed task details"/);
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
  assert.match(singleModeSection, /label: "Goal"/);
  assert.match(singleModeSection, /parsedSingleCommand\.goalName \?\? selectedGoalName/);
  assert.match(singleModeSection, /label: "Status"/);
  assert.match(singleModeSection, /formatDisplayStatus\(singleStatus\)/);
  assert.match(singleModeSection, /label: "Blocked reason"/);
  assert.match(singleModeSection, /singleBlockedReason \|\| "Required"/);
});

test("quick task command errors include goal and blocked errors", () => {
  assert.match(
    quickTaskSheetSource,
    /Boolean\(parsedSingleCommand\.projectError\)[\s\S]+Boolean\(parsedSingleCommand\.goalError\)[\s\S]+Boolean\(parsedSingleCommand\.blockedError\)/,
  );
  assert.match(singleModeSection, /parsedSingleCommand\.goalError/);
  assert.match(singleModeSection, /parsedSingleCommand\.blockedError/);
  assert.match(quickTaskSheetSource, /disabled=\{pending \|\| disabled\}/);
  assert.match(
    singleModeSection,
    /<QuickTaskSubmitButton[\s\S]+pending=\{isSinglePending\}[\s\S]+disabled=\{hasCommandError\}/,
  );
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

test("quick task presents a centered, accessible modal dialog", () => {
  assert.match(
    quickTaskSheetSource,
    /<DialogPrimitive\.Content[\s\S]+aria-labelledby="quick-task-sheet-title"/,
  );
  assert.match(
    quickTaskSheetSource,
    /<DialogPrimitive\.Title[\s\S]+id="quick-task-sheet-title"/,
  );
  assert.match(
    quickTaskSheetSource,
    /<DialogPrimitive\.Description[\s\S]+id="quick-task-sheet-description"/,
  );
  assert.match(quickTaskSheetSource, /fixed left-1\/2 top-1\/2[\s\S]+-translate-x-1\/2 -translate-y-1\/2/);
  assert.match(quickTaskSheetSource, /onCloseAutoFocus=\{\(event\) =>/);
  assert.match(quickTaskSheetSource, /lastFocusedElement\.focus\(\)/);
});

test("quick task optional details retain scheduling, reminders, worked time and description fields", () => {
  assert.match(singleModeSection, /<details[\s\S]+More details[\s\S]+<\/details>/);
  const optionalDetails = getSection(singleModeSection, "<details", "</details>");
  for (const field of [
    'name="scheduledStartAt"',
    'name="scheduledEndAt"',
    'name="calendarSyncEnabled"',
    'name="calendarReminderMinutes"',
    'name="workedTimeStartedAt"',
    'name="workedTimeEndedAt"',
    'name="description"',
  ]) {
    assert.ok(optionalDetails.includes(field), `Optional details must retain ${field}`);
  }
  assert.match(optionalDetails, /type="datetime-local"/);
});

test("quick task multi mode does not render worked-time UI", () => {
  assert.doesNotMatch(multiModeSection, /Already worked on this\?/);
  assert.doesNotMatch(multiModeSection, /quick-task-worked-from/);
  assert.doesNotMatch(multiModeSection, /quick-task-worked-to/);
  assert.doesNotMatch(multiModeSection, /name="workedTimeStartedAt"/);
  assert.doesNotMatch(multiModeSection, /name="workedTimeEndedAt"/);
});

test("quick task single mode rebuilds metadata as one equal two-column grid", () => {
  assert.match(singleModeSection, /grid grid-cols-1 gap-4 sm:grid-cols-2/);

  // `className` strings contain brackets, so compare them literally instead of
  // building a regex that would treat them as a character class.
  const assertControl = (id: string, expectedClass: string) => {
    const controlStart = singleModeSection.indexOf(`id="${id}"`);
    assert.notEqual(controlStart, -1, `missing control: ${id}`);
    // Slice to the end of the element itself: self-closing inputs end with "/>"
    // and selects with "</select>". Prop values can be long, so a fixed window
    // is unreliable.
    const selfClosing = singleModeSection.indexOf("/>", controlStart);
    const selectClose = singleModeSection.indexOf("</select>", controlStart);
    const candidates = [selfClosing, selectClose].filter((index) => index !== -1);
    const elementEnd = candidates.length > 0 ? Math.min(...candidates) : controlStart + 600;
    const element = singleModeSection.slice(controlStart, elementEnd);
    assert.ok(
      element.includes(expectedClass),
      `${id} must carry "${expectedClass}"`,
    );
  };

  assertControl("quick-task-command", 'className="h-11 w-full text-[length:var(--text-body-lg)]"');
  assertControl("quick-task-project", 'className="input-instrument h-11 w-full text-sm"');
  assertControl("quick-task-goal", 'className="input-instrument h-11 w-full text-sm"');
  assertControl("quick-task-status", 'className="input-instrument h-11 w-full text-sm"');
  assertControl("quick-task-priority", 'className="input-instrument h-11 w-full text-sm"');
  assertControl("quick-task-due-date", 'className="h-11 w-full"');
  assertControl("quick-task-estimate", 'className="h-11 w-full"');

  assert.doesNotMatch(singleModeSection, /xl:grid-cols|grid-cols-5/);
});

test("quick task single mode presents More details as a quiet disclosure", () => {
  assert.match(singleModeSection, /<details className="group">/);
  assert.doesNotMatch(singleModeSection, /<details className="group sm:col-span-2/);
  const optionalDetails = getSection(singleModeSection, "<details", "</details>");
  assert.doesNotMatch(optionalDetails, /ega-glass-soft|bg-white/);
  assert.match(optionalDetails, /<summary[\s\S]+More details[\s\S]+<\/summary>/);
});

test("quick task status options use canonical display labels in both modes", () => {
  const singleStatusOptions = getSection(
    singleModeSection,
    'id="quick-task-status"',
    "</select>",
  );
  assert.match(singleStatusOptions, /\{formatDisplayStatus\(status\)\}/);
  assert.doesNotMatch(singleStatusOptions, /formatTaskToken/);

  const multiStatusOptions = getSection(
    multiModeSection,
    "id={`draft-${draft.id}-status`}",
    "</select>",
  );
  assert.match(multiStatusOptions, /\{formatDisplayStatus\(status\)\}/);
  assert.doesNotMatch(multiStatusOptions, /formatTaskToken/);
});

test("quick task calendar reminder carries a unit", () => {
  const reminderField = getSection(
    singleModeSection,
    'name="calendarReminderMinutes"',
    "</div>",
  );
  assert.match(reminderField, /minutes before/);
});

test("quick task sheets carry no legacy gold tokens or hard-coded whites", () => {
  assert.doesNotMatch(quickTaskSheetSource, /ega-gold/);
  assert.doesNotMatch(quickTaskSheetSource, /bg-white/);
  assert.doesNotMatch(quickTaskSheetSource, /accent-\[rgb\(/);
});
