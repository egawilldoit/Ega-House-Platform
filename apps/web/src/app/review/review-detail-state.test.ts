import assert from "node:assert/strict";
import test from "node:test";

import { getReviewDetailFields, toFieldValue } from "./review-detail-state";

test("maps saved review fields into detail sections including next steps", () => {
  assert.deepEqual(
    getReviewDetailFields({
      summary: "Summary",
      wins: "Wins",
      blockers: "Blockers",
      next_steps: "Next steps",
    }),
    [
      { label: "Summary / Reflection", value: "Summary" },
      { label: "Wins", value: "Wins" },
      { label: "Blockers", value: "Blockers" },
      { label: "Next steps", value: "Next steps" },
    ],
  );
});

test("provides the existing fallback for empty detail fields", () => {
  assert.equal(toFieldValue("   "), "Not provided.");
  assert.equal(toFieldValue("Saved"), "Saved");
});
