import assert from "node:assert/strict";
import test from "node:test";

import {
  boardCollapsedStorageKey,
  parseCollapsedColumns,
  readCollapsedColumns,
  serializeCollapsedColumns,
  writeCollapsedColumns,
} from "./task-board-preferences";

function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

test("collapsed columns are validated against the canonical statuses", () => {
  assert.deepEqual(parseCollapsedColumns("todo,in_progress"), ["todo", "in_progress"]);
  assert.deepEqual(parseCollapsedColumns("todo,nope,todo"), ["todo"]);
  assert.deepEqual(parseCollapsedColumns(""), []);
  assert.equal(serializeCollapsedColumns(["done", "done", "bad"]), "done");
});

test("collapse preference is scoped to owner and view", () => {
  const storage = fakeStorage();
  writeCollapsedColumns(storage, "owner-a", "active", ["todo"]);
  writeCollapsedColumns(storage, "owner-b", "active", ["done"]);

  assert.deepEqual(readCollapsedColumns(storage, "owner-a", "active"), ["todo"]);
  assert.deepEqual(readCollapsedColumns(storage, "owner-b", "active"), ["done"]);
  assert.deepEqual(readCollapsedColumns(storage, "owner-a", "archived"), []);
  assert.notEqual(
    boardCollapsedStorageKey("owner-a", "active"),
    boardCollapsedStorageKey("owner-b", "active"),
  );
});

test("storage failures fall back to an expanded board", () => {
  const throwing = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(readCollapsedColumns(throwing, "owner-a", "active"), []);
  assert.doesNotThrow(() => writeCollapsedColumns(throwing, "owner-a", "active", ["todo"]));
  assert.deepEqual(readCollapsedColumns(null, "owner-a", "active"), []);
});
