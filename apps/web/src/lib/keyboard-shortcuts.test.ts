import assert from "node:assert/strict";
import test from "node:test";

import {
  TASK_PRIORITY_KEY_MAP,
  TASK_STATUS_KEY_MAP,
  canHandleCharacterShortcut,
  getShortcutRouteFromSequenceKey,
  isExactShortcutCombo,
  readCharacterShortcutsEnabled,
  shouldOpenShortcutHelp,
  writeCharacterShortcutsEnabled,
} from "./keyboard-shortcuts";

test("maps go-to sequence keys to workspace routes", () => {
  assert.equal(getShortcutRouteFromSequenceKey("d"), "today");
  assert.equal(getShortcutRouteFromSequenceKey("T"), "tasks");
  assert.equal(getShortcutRouteFromSequenceKey("o"), "goals");
  assert.equal(getShortcutRouteFromSequenceKey("i"), "timer");
  assert.equal(getShortcutRouteFromSequenceKey("r"), "review");
  assert.equal(getShortcutRouteFromSequenceKey("a"), "apps");
  assert.equal(getShortcutRouteFromSequenceKey("x"), null);
});

test("detects exact modifier combos without false positives", () => {
  assert.equal(
    isExactShortcutCombo(
      { key: "n", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false },
      { key: "n", metaOrCtrl: true, shift: true },
    ),
    true,
  );

  assert.equal(
    isExactShortcutCombo(
      { key: "n", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false },
      { key: "n", metaOrCtrl: true, shift: true },
    ),
    false,
  );
});

test("opens shortcut help only for question mark without extra modifiers", () => {
  assert.equal(shouldOpenShortcutHelp({ key: "?", ctrlKey: false, metaKey: false, altKey: false }), true);
  assert.equal(shouldOpenShortcutHelp({ key: "?", ctrlKey: true, metaKey: false, altKey: false }), false);
});

test("task status and priority keys use an explicit mapping", () => {
  assert.deepEqual(TASK_STATUS_KEY_MAP, {
    "1": "todo",
    "2": "in_progress",
    "3": "review",
    "4": "done",
    "5": "blocked",
  });
  assert.deepEqual(TASK_PRIORITY_KEY_MAP, {
    "1": "low",
    "2": "medium",
    "3": "high",
    "4": "urgent",
  });
});

test("character shortcuts are disabled per owner, not globally", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };

  assert.equal(readCharacterShortcutsEnabled(storage, "owner-a"), true);
  writeCharacterShortcutsEnabled(storage, "owner-a", false);
  assert.equal(readCharacterShortcutsEnabled(storage, "owner-a"), false);
  // A different owner on the same browser keeps the default.
  assert.equal(readCharacterShortcutsEnabled(storage, "owner-b"), true);
});

test("character shortcuts ignore modifiers, IME composition and editable targets", () => {
  const base = {
    key: "4",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    isComposing: false,
    target: null,
  };

  assert.equal(canHandleCharacterShortcut({ ...base }, true), true);
  assert.equal(canHandleCharacterShortcut({ ...base }, false), false);
  assert.equal(canHandleCharacterShortcut({ ...base, metaKey: true }, true), false);
  assert.equal(canHandleCharacterShortcut({ ...base, isComposing: true }, true), false);
  assert.equal(canHandleCharacterShortcut({ ...base, key: "Shift", target: null }, true), false);
});
