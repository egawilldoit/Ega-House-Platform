import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveWeeklyReviewPageFormDefaults,
  type WeeklyReviewPageSelectedReview,
} from "./weekly-review-page-service";

const generatedDraft = {
  summary: "Generated summary",
  wins: "Generated wins",
  blockers: "Generated blockers",
  nextSteps: "Generated next steps",
};

const savedReview: WeeklyReviewPageSelectedReview = {
  id: "review-1",
  summary: " Saved summary ",
  wins: " Saved wins ",
  blockers: " Saved blockers ",
  next_steps: " Saved next steps ",
  created_at: "2026-05-01T00:00:00.000Z",
  updated_at: "2026-05-02T00:00:00.000Z",
};

test("resolveWeeklyReviewPageFormDefaults prefers saved review fields by default", () => {
  assert.deepEqual(
    resolveWeeklyReviewPageFormDefaults({
      generatedDraft,
      selectedReview: savedReview,
      selectedWeekOf: "2026-05-04",
      useGeneratedDraft: false,
    }),
    {
      summary: "Saved summary",
      wins: "Saved wins",
      blockers: "Saved blockers",
      nextSteps: "Saved next steps",
      weekOf: "2026-05-04",
    },
  );
});

test("resolveWeeklyReviewPageFormDefaults uses generated draft when requested", () => {
  assert.deepEqual(
    resolveWeeklyReviewPageFormDefaults({
      generatedDraft,
      selectedReview: savedReview,
      selectedWeekOf: "2026-05-04",
      useGeneratedDraft: true,
    }),
    {
      ...generatedDraft,
      weekOf: "2026-05-04",
    },
  );
});

test("resolveWeeklyReviewPageFormDefaults uses generated draft when no saved review exists", () => {
  assert.deepEqual(
    resolveWeeklyReviewPageFormDefaults({
      generatedDraft,
      selectedReview: null,
      selectedWeekOf: "2026-05-04",
      useGeneratedDraft: false,
    }),
    {
      ...generatedDraft,
      weekOf: "2026-05-04",
    },
  );
});
