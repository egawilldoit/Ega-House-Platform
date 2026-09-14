import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function read(...segments: string[]) {
  return readFileSync(path.join(process.cwd(), "src", ...segments), "utf8");
}

const captureSource = read("components", "inbox", "inbox-capture-sheet.tsx");
const triggerSource = read("components", "inbox", "inbox-capture-trigger.tsx");
const shortcutSource = read("components", "layout", "workspace-keyboard-shortcuts.tsx");
const keyboardDefs = read("lib", "keyboard-shortcuts.ts");
const sidebarSource = read("components", "layout", "sidebar.tsx");
const drawerSource = read("components", "layout", "sidebar-mobile-drawer.tsx");
const controllersSource = read("components", "layout", "global-quick-action-controllers.tsx");
const appShellSource = read("components", "layout", "app-shell.tsx");
const captureActionSource = read("components", "inbox", "capture-action.ts");
const ideaServiceSource = read("lib", "services", "idea-note-service.ts");

test("inbox capture accepts raw thought without project/goal/priority (unstructured global)", () => {
  assert.match(captureSource, /htmlFor="inbox-capture-title"/);
  assert.match(captureSource, /htmlFor="inbox-capture-body"/);
  assert.doesNotMatch(captureSource, /projectId/);
  assert.doesNotMatch(captureSource, /QuickTaskSheetProject/);
  assert.match(captureActionSource, /createIdeaNote/);
  assert.match(captureSource, /placeholder="Follow up on onboarding insight"/);
});

test("inbox capture raw text is trimmed and required", () => {
  assert.match(captureSource, /const trimmedTitle = title\.trim\(\)/);
  assert.match(captureSource, /if \(!trimmedTitle\)/);
  assert.match(captureSource, /Title is required/);
});

test("inbox capture uses client-generated idempotency key and preserves it for retry", () => {
  assert.match(captureSource, /createIdempotencyKey/);
  assert.match(captureSource, /idempotencyKeyRef\.current/);
  assert.match(captureSource, /X-Idempotency-Key|idempotencyKey/);
  assert.match(captureSource, /saveDraft.*idempotencyKey/);
  assert.match(captureSource, /setError\(/);
  assert.match(captureSource, /if \(!result\.ok\)/);
  assert.match(captureSource, /setError\(result\.error\)/);
  assert.match(captureSource, /return;/);
  assert.match(captureSource, /clearDraftStorage/);
  assert.match(captureSource, /idempotencyKeyRef\.current = createIdempotencyKey/);
});

test("inbox capture preserves draft on transient failure and never reports false success", () => {
  assert.match(captureSource, /try \{[\s\S]+captureInboxIdea/);
  assert.match(captureSource, /catch \(err\)[\s\S]+setError\(/);
  assert.match(captureSource, /saveDraft\(\{ title, body, idempotencyKey: keyToUse \}\)/);
  assert.match(captureSource, /if \(!result\.ok\)[\s\S]+setError/);
  assert.match(captureSource, /setSuccess\("Idea captured\."\)/);
});

test("inbox capture keyboard accessibility: focus, Esc, shortcut", () => {
  assert.match(captureSource, /document\.getElementById\("inbox-capture-title"\)\?\.focus\(\)/);
  assert.match(captureSource, /aria-label="Inbox capture title"/);
  assert.match(captureSource, /aria-label="Close inbox capture panel"/);
  assert.match(captureSource, /role="alert"/);
  assert.match(captureSource, /onOpenChange/);
  assert.match(shortcutSource, /INBOX_CAPTURE_EVENT/);
  assert.match(shortcutSource, /isExactShortcutCombo\(event, \{ key: "i", metaOrCtrl: true, shift: true \}\)/);
  assert.match(keyboardDefs, /open-inbox-capture/);
  assert.match(keyboardDefs, /Ctrl\/Cmd \+ Shift \+ I/);
});

test("EGA-649: one shell-level owner for Inbox Capture and Quick Task", () => {
  // The shell mounts exactly one controller tree...
  assert.match(appShellSource, /GlobalQuickActionControllers/);
  assert.match(controllersSource, /<InboxCaptureSheet/);
  assert.match(controllersSource, /<QuickTaskSheet/);
  assert.match(controllersSource, /showTrigger=\{false\}/);

  // ...and navigation surfaces only render triggers, never a second controller.
  for (const source of [sidebarSource, drawerSource]) {
    assert.match(source, /InboxCaptureTrigger/);
    assert.match(source, /SidebarCreateTaskButton/);
    assert.doesNotMatch(source, /<QuickTaskSheet/);
    assert.doesNotMatch(source, /<InboxCaptureSheet/);
    assert.doesNotMatch(source, /InboxQuickCapture/);
  }

  // Shortcuts remain distinct: N for task, I for inbox.
  assert.match(shortcutSource, /key: "n"/);
  assert.match(shortcutSource, /QUICK_TASK_EVENT/);
  assert.match(shortcutSource, /key: "i"/);
  assert.match(shortcutSource, /INBOX_CAPTURE_EVENT/);
  assert.match(keyboardDefs, /open-quick-task.*Ctrl\/Cmd \+ Shift \+ N/);
  assert.match(keyboardDefs, /open-inbox-capture.*Ctrl\/Cmd \+ Shift \+ I/);
});

test("EGA-649: drawer triggers close the drawer before opening the global sheet", () => {
  // Triggers read the drawer context and close it deterministically (no timeout).
  assert.match(triggerSource, /useWorkspaceDrawer/);
  assert.match(triggerSource, /closeDrawer\(\{ restoreFocus: false \}\)/);
  const createTaskSource = read("components", "layout", "sidebar-create-task.tsx");
  assert.match(createTaskSource, /useWorkspaceDrawer/);
  assert.match(createTaskSource, /closeDrawer\(\{ restoreFocus: false \}\)/);
  assert.doesNotMatch(triggerSource, /setTimeout/);
  assert.doesNotMatch(createTaskSource, /setTimeout/);
});

test("capture action and idea-note-service handle idempotencyKey server-side", () => {
  assert.match(captureActionSource, /idempotencyKey/);
  assert.match(captureActionSource, /createIdeaNote/);
  assert.match(ideaServiceSource, /inbox_idempotency_keys/);
  assert.match(ideaServiceSource, /idempotencyKey/);
});

test("inbox capture success updates state without full-page refresh", () => {
  assert.match(captureSource, /router\.refresh\(\)/);
  assert.doesNotMatch(captureSource, /window\.location\.reload/);
});

test("inbox capture sheet and trigger expose stable test ids", () => {
  assert.match(triggerSource, /data-testid="inbox-quick-capture-trigger"/);
  assert.match(captureSource, /data-testid="inbox-quick-capture-sheet"/);
  assert.match(captureSource, /data-testid="inbox-capture-title-input"/);
  assert.match(captureSource, /data-testid="inbox-capture-submit"/);
});
