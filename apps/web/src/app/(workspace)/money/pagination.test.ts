import assert from "node:assert/strict";
import test from "node:test";

import {
  MONEY_PAGE_SIZE,
  MAX_MONEY_PAGER_OFFSET,
  moneyHref,
  parseMoneyHistoryKind,
  resolveMoneyHistoryState,
} from "./pagination";

test("the unified history offset defaults to zero and the kind filter to all", () => {
  assert.deepEqual(resolveMoneyHistoryState({}), { offset: 0, kind: null, scope: "period" });
});

test("a legacy pager parameter lands on one bounded history page", () => {
  assert.deepEqual(resolveMoneyHistoryState({ offset: "25" }), {
    offset: 25,
    kind: null,
    scope: "period",
  });
  assert.deepEqual(resolveMoneyHistoryState({ expenseOffset: "50" }), {
    offset: 50,
    kind: null,
    scope: "period",
  });
  assert.deepEqual(resolveMoneyHistoryState({ movementOffset: "75" }), {
    offset: 75,
    kind: null,
    scope: "period",
  });
});

test("a valid kind filter is parsed and an invalid one falls back to all", () => {
  assert.equal(parseMoneyHistoryKind("expense"), "expense");
  assert.equal(parseMoneyHistoryKind("savings_transfer"), "savings_transfer");
  assert.equal(parseMoneyHistoryKind("opening"), "opening");
  assert.equal(parseMoneyHistoryKind("not_a_kind"), null);
  assert.equal(parseMoneyHistoryKind(""), null);
  assert.deepEqual(resolveMoneyHistoryState({ kind: "income", offset: "25" }), {
    offset: 25,
    kind: "income",
    scope: "period",
  });
});

test("invalid offsets fall back to zero and excessive offsets are clamped", () => {
  assert.equal(resolveMoneyHistoryState({ offset: "-25" }).offset, 0);
  assert.equal(resolveMoneyHistoryState({ offset: "abc" }).offset, 0);
  assert.equal(
    resolveMoneyHistoryState({ offset: "999999999999999999999999" }).offset,
    0,
  );
  assert.equal(
    resolveMoneyHistoryState({ offset: String(MAX_MONEY_PAGER_OFFSET + 1) }).offset,
    MAX_MONEY_PAGER_OFFSET,
  );
});

test("the explicit all-history scope is parsed and retained in links", () => {
  assert.equal(resolveMoneyHistoryState({ scope: "all" }).scope, "all");
  assert.equal(
    moneyHref({
      periodId: "period-42",
      offset: 0,
      kind: null,
      scope: "all",
    }),
    "/money?periodId=period-42&scope=all",
  );
});

test("history links keep the selected period, page and kind", () => {
  assert.equal(
    moneyHref({
      periodId: "period-42",
      offset: MONEY_PAGE_SIZE,
      kind: "expense",
    }),
    "/money?periodId=period-42&offset=25&kind=expense",
  );
});

test("history links omit absent state and encode special period ids", () => {
  assert.equal(
    moneyHref({ periodId: null, offset: 0, kind: null }),
    "/money",
  );
  assert.equal(
    moneyHref({ periodId: "a b&c", offset: 0, kind: null }),
    "/money?periodId=a+b%26c",
  );
});
