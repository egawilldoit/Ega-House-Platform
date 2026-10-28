import assert from "node:assert/strict";
import test from "node:test";

import {
  TASK_COMMENT_DRAFT_PREFIX,
  clearTaskCommentDraft,
  readTaskCommentDraft,
  taskCommentDraftKey,
  writeTaskCommentDraft,
} from "@/lib/task-comment-draft";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("drafts are scoped to one owner and one task", () => {
  const storage = memoryStorage();
  writeTaskCommentDraft(storage, "owner-a", "task-1", "hello @codex");
  assert.equal(readTaskCommentDraft(storage, "owner-a", "task-1"), "hello @codex");
  assert.equal(readTaskCommentDraft(storage, "owner-b", "task-1"), "");
  assert.equal(readTaskCommentDraft(storage, "owner-a", "task-2"), "");
  assert.match(taskCommentDraftKey("owner-a", "task-1"), new RegExp(`^${TASK_COMMENT_DRAFT_PREFIX}`));
});

test("account switching cannot read a foreign draft even with a copied payload", () => {
  const storage = memoryStorage();
  storage.setItem(
    taskCommentDraftKey("owner-a", "task-1"),
    JSON.stringify({ ownerId: "owner-a", taskId: "task-1", body: "secret" }),
  );
  // Same task id under the second account is a different key.
  assert.equal(readTaskCommentDraft(storage, "owner-b", "task-1"), "");
  // A copied payload in the wrong namespace is rejected by the payload guard.
  storage.setItem(
    taskCommentDraftKey("owner-b", "task-1"),
    JSON.stringify({ ownerId: "owner-a", taskId: "task-1", body: "secret" }),
  );
  assert.equal(readTaskCommentDraft(storage, "owner-b", "task-1"), "");
});

test("malformed, oversized and cleared drafts stay safe", () => {
  const storage = memoryStorage();
  storage.setItem(taskCommentDraftKey("owner-a", "task-1"), "{bad json");
  assert.equal(readTaskCommentDraft(storage, "owner-a", "task-1"), "");

  writeTaskCommentDraft(storage, "owner-a", "task-1", "x".repeat(5000));
  assert.equal(readTaskCommentDraft(storage, "owner-a", "task-1").length, 4000);

  clearTaskCommentDraft(storage, "owner-a", "task-1");
  assert.equal(readTaskCommentDraft(storage, "owner-a", "task-1"), "");

  writeTaskCommentDraft(storage, "owner-a", "task-1", "   ");
  assert.equal(storage.getItem(taskCommentDraftKey("owner-a", "task-1")), null);
});

test("unavailable storage degrades to no draft instead of throwing", () => {
  assert.equal(readTaskCommentDraft(null, "owner-a", "task-1"), "");
  assert.doesNotThrow(() => writeTaskCommentDraft(null, "owner-a", "task-1", "x"));
  assert.doesNotThrow(() => clearTaskCommentDraft(null, "owner-a", "task-1"));
  assert.equal(readTaskCommentDraft(memoryStorage(), null, "task-1"), "");
});
