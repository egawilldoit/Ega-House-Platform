import assert from "node:assert/strict";
import test from "node:test";

import {
  getShortcutRouteFromSequenceKey,
  isExactShortcutCombo,
  shouldOpenShortcutHelp,
} from "./keyboard-shortcuts";

test("maps go-to sequence keys to workspace routes", () => {
  assert.equal(getShortcutRouteFromSequenceKey("d"), "dashboard");
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
