import assert from "node:assert/strict";
import test from "node:test";

import { createInboxInputSchema, updateInboxInputSchema, inboxListQuerySchema } from "../src/inbox";
import { INBOX_STATUSES, INBOX_TYPES, MANUAL_INBOX_STATUSES } from "@ega/domain";

test("inbox contracts preserve status and type domain values", () => {
  assert.deepEqual([...MANUAL_INBOX_STATUSES], ["inbox", "reviewing", "planned", "archived"]);
  assert.ok(INBOX_STATUSES.includes("converted"));
  assert.deepEqual([...INBOX_TYPES], ["idea", "feature", "bug", "improvement", "research"]);
});

test("create inbox input schema validates title", () => {
  const valid = createInboxInputSchema.safeParse({ title: " Idea " });
  assert.equal(valid.success, true);
  const invalid = createInboxInputSchema.safeParse({ title: "   " });
  assert.equal(invalid.success, false);
});

test("update inbox input schema requires id and status", () => {
  const missing = updateInboxInputSchema.safeParse({ title: "Idea", status: "inbox" } as any);
  assert.equal(missing.success, false);
  const valid = updateInboxInputSchema.safeParse({ id: "idea-1", title: "Idea", status: "reviewing" });
  assert.equal(valid.success, true);
});

test("inbox list query schema accepts known view values", () => {
  const ok = inboxListQuerySchema.safeParse({ view: "archived", type: "bug" });
  assert.equal(ok.success, true);
  // unknown view is rejected by zod enum
  const unknown = inboxListQuerySchema.safeParse({ view: "unknown" });
  assert.equal(unknown.success, false);
});
