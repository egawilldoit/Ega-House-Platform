import assert from "node:assert/strict";
import test from "node:test";

import {
  BoardRankError,
  compareBoardRanks,
  generateBoardRankAfter,
  generateBoardRankBefore,
  generateBoardRankBetween,
  isBoardRank,
  moveBoardItem,
  sortByBoardRank,
} from "../src/tasks/board-rank";
import {
  getTaskStatusTransitions,
  isTaskStatusTransitionAllowed,
} from "../src/tasks/status";

function isStrictlyOrdered(keys: string[]) {
  return keys.every((key, index) => index === 0 || keys[index - 1] < key);
}

test("ranks are validated before they reach persistence", () => {
  assert.equal(isBoardRank("0"), true);
  assert.equal(isBoardRank("20261028120000000000"), true);
  assert.equal(isBoardRank("abc"), false);
  assert.equal(isBoardRank("A B"), false);
  assert.equal(isBoardRank(""), false);
  assert.equal(isBoardRank(null), false);
  assert.throws(() => generateBoardRankBetween("a", null), BoardRankError);
});

test("null ranks sort after ranked rows and ties break on the stable id", () => {
  const sorted = sortByBoardRank([
    { id: "c", board_rank: null },
    { id: "b", board_rank: "A" },
    { id: "a", board_rank: "A" },
    { id: "d", board_rank: "0" },
  ]);
  assert.deepEqual(sorted.map((item) => item.id), ["d", "a", "b", "c"]);
  assert.equal(compareBoardRanks(null, "0"), 1);
  assert.equal(compareBoardRanks("0", "00"), -1);
});

test("between handles empty, top, tail, prefix and adjacent gaps", () => {
  assert.equal(generateBoardRankBetween(null, null), "H");
  assert.ok(generateBoardRankBefore("1") < "1");
  assert.ok(generateBoardRankAfter("1") > "1");
  assert.ok(generateBoardRankAfter("0000000001") > "0000000001");

  const cases: Array<[string | null, string | null]> = [
    ["A", "B"],
    ["1", "2"],
    ["0", "1"],
    ["AA", "AB"],
    ["A", "AB"],
    ["0Z", "1"],
    ["0000000001", "0000000002"],
    ["20261028120000000000", "20261028120000000001"],
    [null, "H"],
    [null, "0000000001"],
    ["Z", null],
  ];

  for (const [prev, next] of cases) {
    const key = generateBoardRankBetween(prev, next);
    assert.ok(isBoardRank(key), `${prev}..${next} produced an invalid key`);
    if (prev !== null) assert.ok(prev < key, `${key} must sort after ${prev}`);
    if (next !== null) assert.ok(key < next, `${key} must sort before ${next}`);
  }
});

test("a column of repeated inserts stays strictly ordered", () => {
  const keys: string[] = [];
  // Deterministic spread of insertion points: top, tail, then middles.
  const targets = [0, 1, 1, 2, 0, 3, 2, 4, 1, 3, 0, 5];
  for (const target of targets) {
    const index = Math.min(target, keys.length);
    const key = generateBoardRankBetween(
      index === 0 ? null : keys[index - 1] ?? null,
      index >= keys.length ? null : keys[index] ?? null,
    );
    keys.splice(index, 0, key);
  }
  assert.equal(keys.length, targets.length);
  assert.ok(isStrictlyOrdered(keys), keys.join(","));
});

test("two moves into the same gap are deterministic and remain ordered", () => {
  const first = generateBoardRankBetween("A", "B");
  const second = generateBoardRankBetween("A", "B");
  assert.equal(first, second);
  const ordered = sortByBoardRank([
    { id: "task-2", board_rank: first },
    { id: "task-1", board_rank: second },
    { id: "before", board_rank: "A" },
    { id: "after", board_rank: "B" },
  ]);
  assert.deepEqual(ordered.map((item) => item.id), ["before", "task-1", "task-2", "after"]);
});

test("moveBoardItem clamps the target and preserves every item", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(moveBoardItem(items, "c", 0).map((item) => item.id), ["c", "a", "b"]);
  assert.deepEqual(moveBoardItem(items, "a", 99).map((item) => item.id), ["b", "c", "a"]);
  assert.deepEqual(moveBoardItem(items, "missing", 1).map((item) => item.id), ["a", "b", "c"]);
});

test("status transitions are the same for drag, buttons and tap alternatives", () => {
  assert.deepEqual(getTaskStatusTransitions("todo"), ["in_progress", "blocked", "done"]);
  assert.deepEqual(getTaskStatusTransitions("done"), ["todo"]);
  assert.deepEqual(getTaskStatusTransitions("unknown"), []);
  assert.equal(isTaskStatusTransitionAllowed("review", "done"), true);
  assert.equal(isTaskStatusTransitionAllowed("done", "in_progress"), false);
  assert.equal(isTaskStatusTransitionAllowed("todo", "review"), false);
  assert.equal(isTaskStatusTransitionAllowed("nope", "done"), false);
});

test("repeated insertion at the same visual position never exhausts the gap", () => {
  // Backfilled columns start at 0000000001, 0000000002, ...; dropping a card
  // just below the first card repeatedly used to hit an empty gap after a few
  // moves because the generator returned the smallest endpoint.
  const lower = "0000000001";
  let upper = "0000000002";
  let previous = upper;
  for (let index = 0; index < 200; index += 1) {
    const key = generateBoardRankBetween(lower, upper);
    assert.ok(lower < key, `${key} must sort after ${lower}`);
    assert.ok(key < upper, `${key} must sort before ${upper}`);
    upper = key;
  }
  assert.ok(previous > upper);
});

test("repeated insertion above a prefix-shaped neighbour stays inside the gap", () => {
  let upper = "I";
  for (let index = 0; index < 200; index += 1) {
    const key = generateBoardRankBetween("A", upper);
    assert.ok("A" < key, `${key} must sort after A`);
    assert.ok(key < upper, `${key} must sort before ${upper}`);
    upper = key;
  }
});
