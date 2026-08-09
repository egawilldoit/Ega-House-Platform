import assert from "node:assert/strict";
import test from "node:test";

import { resolveMatchingWeeklyReview } from "./weekly-review-match";

const BASE_WEEK_START = "2026-04-13";
const BASE_WEEK_END = "2026-04-19";
const USER_A = "user-a";
const USER_B = "user-b";

test("first weekly review creates when no matching week review exists", () => {
  const matched = resolveMatchingWeeklyReview([], {
    ownerUserId: USER_A,
    weekStart: BASE_WEEK_START,
    weekEnd: BASE_WEEK_END,
  });

  assert.equal(matched, null);
});

test("second save in the same week matches existing review for update", () => {
  const matched = resolveMatchingWeeklyReview(
    [
      {
        id: "review-1",
        owner_user_id: USER_A,
        week_start: BASE_WEEK_START,
        week_end: BASE_WEEK_END,
        created_at: "2026-04-19T09:00:00.000Z",
        updated_at: "2026-04-19T09:00:00.000Z",
      },
    ],
    {
      ownerUserId: USER_A,
      weekStart: BASE_WEEK_START,
      weekEnd: BASE_WEEK_END,
    },
  );

  assert.equal(matched?.id, "review-1");
});

test("different week does not match and should create a new review", () => {
  const matched = resolveMatchingWeeklyReview(
    [
      {
        id: "review-1",
        owner_user_id: USER_A,
        week_start: "2026-04-06",
        week_end: "2026-04-12",
        created_at: "2026-04-12T09:00:00.000Z",
        updated_at: "2026-04-12T09:00:00.000Z",
      },
    ],
    {
      ownerUserId: USER_A,
      weekStart: BASE_WEEK_START,
      weekEnd: BASE_WEEK_END,
    },
  );

  assert.equal(matched, null);
});

test("user scope is respected when another user already has a same-week review", () => {
  const matched = resolveMatchingWeeklyReview(
    [
      {
        id: "review-b",
        owner_user_id: USER_B,
        week_start: BASE_WEEK_START,
        week_end: BASE_WEEK_END,
        created_at: "2026-04-19T09:00:00.000Z",
        updated_at: "2026-04-19T09:00:00.000Z",
      },
    ],
    {
      ownerUserId: USER_A,
      weekStart: BASE_WEEK_START,
      weekEnd: BASE_WEEK_END,
    },
  );

  assert.equal(matched, null);
});
