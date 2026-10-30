// @vitest-environment jsdom
import assert from "node:assert/strict";
import { test } from "vitest";

import { canHandleCharacterShortcut } from "./keyboard-shortcuts";

const base = {
  key: "4",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  isComposing: false,
  target: null,
};

test("character shortcuts ignore editable controls", () => {
  const input = document.createElement("input");
  assert.equal(canHandleCharacterShortcut({ ...base, target: input }, true), false);

  const textarea = document.createElement("textarea");
  assert.equal(canHandleCharacterShortcut({ ...base, target: textarea }, true), false);
});

test("a nested dialog does not receive drawer task keys unless it is the drawer scope", () => {
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  const button = document.createElement("button");
  dialog.append(button);
  assert.equal(canHandleCharacterShortcut({ ...base, target: button }, true), false);

  const scope = document.createElement("div");
  scope.setAttribute("data-task-shortcut-scope", "");
  const scopedButton = document.createElement("button");
  scope.append(scopedButton);
  dialog.append(scope);
  assert.equal(canHandleCharacterShortcut({ ...base, target: scopedButton }, true), true);
});
