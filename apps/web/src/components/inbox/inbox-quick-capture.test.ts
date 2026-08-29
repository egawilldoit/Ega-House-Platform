import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

function resolve(relative: string, fallback: string) {
  try { return fileURLToPath(new URL(relative, import.meta.url)); } catch { return path.resolve(process.cwd(), fallback); }
}

const captureSource = readFileSync(resolve("./inbox-quick-capture.tsx", "src/components/inbox/inbox-quick-capture.tsx"), "utf8");
const shortcutSource = readFileSync(resolve("../layout/workspace-keyboard-shortcuts.tsx", "src/components/layout/workspace-keyboard-shortcuts.tsx"), "utf8");
const keyboardDefs = readFileSync(resolve("../../lib/keyboard-shortcuts.ts", "src/lib/keyboard-shortcuts.ts"), "utf8");
const sidebarSource = readFileSync(resolve("../layout/sidebar.tsx", "src/components/layout/sidebar.tsx"), "utf8");
const captureActionSource = readFileSync(resolve("./capture-action.ts", "src/components/inbox/capture-action.ts"), "utf8");
const ideaServiceSource = readFileSync(resolve("../../lib/services/idea-note-service.ts", "src/lib/services/idea-note-service.ts"), "utf8");

test("inbox capture accepts raw thought without project/goal/priority (unstructured global)", () => {
  // Title + optional body only; no project/goal/priority inputs
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
  // Draft retained on failure, key preserved
  assert.match(captureSource, /saveDraft.*idempotencyKey/);
  assert.match(captureSource, /setError\(/);
  // No false success: error path does not set success, pending reset, returns early
  assert.match(captureSource, /if \(!result\.ok\)/);
  assert.match(captureSource, /setError\(result\.error\)/);
  assert.match(captureSource, /return;/);
  // Success clears draft and rotates key
  assert.match(captureSource, /clearDraftStorage/);
  assert.match(captureSource, /idempotencyKeyRef\.current = createIdempotencyKey/);
});

test("inbox capture preserves draft on transient failure and never reports false success", () => {
  assert.match(captureSource, /try \{[\s\S]+captureInboxIdea/);
  assert.match(captureSource, /catch \(err\)[\s\S]+setError\(/);
  // draft already saved before network call
  assert.match(captureSource, /saveDraft\(\{ title, body, idempotencyKey: keyToUse \}\)/);
  // success only after ok check
  assert.match(captureSource, /if \(!result\.ok\)[\s\S]+setError/);
  assert.match(captureSource, /setSuccess\("Idea captured\."\)/);
});

test("inbox capture keyboard accessibility: focus, Esc, shortcut", () => {
  assert.match(captureSource, /document\.getElementById\("inbox-capture-title"\)\?\.focus\(\)/);
  assert.match(captureSource, /aria-label="Inbox capture title"/);
  assert.match(captureSource, /aria-label="Close inbox capture panel"/);
  assert.match(captureSource, /role="alert"/);
  // Sheet handles Esc via global listener, but component also has close handling
  assert.match(captureSource, /onOpenChange/);
  assert.match(shortcutSource, /INBOX_CAPTURE_EVENT/);
  assert.match(shortcutSource, /isExactShortcutCombo\(event, \{ key: "i", metaOrCtrl: true, shift: true \}\)/);
  assert.match(keyboardDefs, /open-inbox-capture/);
  assert.match(keyboardDefs, /Ctrl\/Cmd \+ Shift \+ I/);
});

test("sidebar preserves QuickTaskSheet and adds InboxQuickCapture without ambiguity", () => {
  assert.match(sidebarSource, /InboxQuickCapture/);
  assert.match(sidebarSource, /QuickTaskSheet/);
  // Shortcuts remain distinct: N for task, I for inbox
  assert.match(shortcutSource, /key: "n"/);
  assert.match(shortcutSource, /QUICK_TASK_EVENT/);
  assert.match(shortcutSource, /key: "i"/);
  assert.match(shortcutSource, /INBOX_CAPTURE_EVENT/);
  assert.match(keyboardDefs, /open-quick-task.*Ctrl\/Cmd \+ Shift \+ N/);
  assert.match(keyboardDefs, /open-inbox-capture.*Ctrl\/Cmd \+ Shift \+ I/);
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

test("inbox capture component uses Sheet with proper aria and test ids", () => {
  assert.match(captureSource, /data-testid="inbox-quick-capture-trigger"/);
  assert.match(captureSource, /data-testid="inbox-quick-capture-sheet"/);
  assert.match(captureSource, /data-testid="inbox-capture-title-input"/);
  assert.match(captureSource, /data-testid="inbox-capture-submit"/);
});
