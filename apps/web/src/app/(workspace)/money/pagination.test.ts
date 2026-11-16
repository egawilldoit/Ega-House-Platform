import assert from "node:assert/strict";
import test from "node:test";

import {
  MONEY_PAGE_SIZE,
  MAX_MONEY_PAGER_OFFSET,
  moneyHref,
  resolveMoneyPagerOffsets,
} from "./pagination";

test("pager offsets default to zero", () => {
  assert.deepEqual(resolveMoneyPagerOffsets({}), {
    expenseOffset: 0,
    movementOffset: 0,
  });
});

test("a legacy offset seeds both pagers", () => {
  assert.deepEqual(resolveMoneyPagerOffsets({ offset: "25" }), {
    expenseOffset: 25,
    movementOffset: 25,
  });
});

test("dedicated pager parameters win independently", () => {
  assert.deepEqual(
    resolveMoneyPagerOffsets({ offset: "50", expenseOffset: "75" }),
    { expenseOffset: 75, movementOffset: 50 },
  );
  assert.deepEqual(
    resolveMoneyPagerOffsets({ offset: "50", movementOffset: "75" }),
    { expenseOffset: 50, movementOffset: 75 },
  );
  assert.deepEqual(
    resolveMoneyPagerOffsets({ expenseOffset: "25", movementOffset: "50" }),
    { expenseOffset: 25, movementOffset: 50 },
  );
});

test("invalid offsets fall back to zero and excessive offsets are clamped", () => {
  assert.deepEqual(
    resolveMoneyPagerOffsets({
      offset: "-25",
      expenseOffset: "abc",
      movementOffset: "999999999999999999999999",
    }),
    { expenseOffset: 0, movementOffset: 0 },
  );
  assert.deepEqual(
    resolveMoneyPagerOffsets({
      expenseOffset: String(MAX_MONEY_PAGER_OFFSET),
      movementOffset: String(MAX_MONEY_PAGER_OFFSET + 1),
    }),
    {
      expenseOffset: MAX_MONEY_PAGER_OFFSET,
      movementOffset: MAX_MONEY_PAGER_OFFSET,
    },
  );
});

test("pager links keep the selected period and the other pager's offset", () => {
  assert.equal(
    moneyHref({
      periodId: "period-42",
      expenseOffset: MONEY_PAGE_SIZE,
      movementOffset: MONEY_PAGE_SIZE * 2,
    }),
    "/money?periodId=period-42&expenseOffset=25&movementOffset=50",
  );
});

test("pager links omit absent state and encode special period ids", () => {
  assert.equal(
    moneyHref({ periodId: null, expenseOffset: 0, movementOffset: 0 }),
    "/money",
  );
  assert.equal(
    moneyHref({ periodId: "a b&c", expenseOffset: 0, movementOffset: 25 }),
    "/money?periodId=a+b%26c&movementOffset=25",
  );
});
