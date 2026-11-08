import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Intra-branch migration journal invariant.
 *
 * Drizzle treats a migration as already applied when its `when` is below the
 * maximum already recorded. This test proves the current branch's journal is
 * strictly ascending, unique and duplicate-free. It does NOT prove cross-branch
 * merge order; that dependency is documented in the migration itself and in
 * the PR (Track D 0079 -> Track C 0088 -> this 0089).
 */
test("drizzle journal is unique and strictly ascending by when", async () => {
  const journal = JSON.parse(
    await readFile(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"),
  );
  assert.ok(Array.isArray(journal.entries), "journal.entries must be an array");
  assert.ok(journal.entries.length > 0, "journal must not be empty");

  const seenIdx = new Set();
  const seenWhen = new Set();
  const seenTag = new Set();

  for (let index = 0; index < journal.entries.length; index += 1) {
    const entry = journal.entries[index];
    assert.equal(typeof entry.idx, "number", `entry ${index} idx must be numeric`);
    assert.equal(typeof entry.when, "number", `entry ${index} when must be numeric`);
    assert.equal(typeof entry.tag, "string", `entry ${index} tag must be a string`);
    assert.ok(!seenIdx.has(entry.idx), `duplicate idx ${entry.idx}`);
    assert.ok(!seenWhen.has(entry.when), `duplicate when ${entry.when}`);
    assert.ok(!seenTag.has(entry.tag), `duplicate tag ${entry.tag}`);
    seenIdx.add(entry.idx);
    seenWhen.add(entry.when);
    seenTag.add(entry.tag);

    if (index > 0) {
      const previous = journal.entries[index - 1];
      assert.ok(
        entry.when > previous.when,
        `journal array order must be strictly ascending by when: ${previous.tag} (${previous.when}) before ${entry.tag} (${entry.when})`,
      );
    }
  }
});
