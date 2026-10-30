import assert from "node:assert/strict";
import test from "node:test";

import {
  getEmptyReviewFormValues,
  getReviewFormValuesFromFormData,
  getReviewFormValuesFromRecord,
  toWeekReviewWriteFields,
} from "./review-form-state";

test("parses and trims review form fields from form data", () => {
  const formData = new FormData();
  formData.set("weekOf", " 2026-04-18 ");
  formData.set("summary", " Wrapped up the main cycle. ");
  formData.set("wins", "  Closed key bugs.  ");
  formData.set("blockers", " Waiting on review. ");
  formData.set("next_steps", " Start next sprint. ");

  assert.deepEqual(getReviewFormValuesFromFormData(formData), {
    weekOf: "2026-04-18",
    summary: "Wrapped up the main cycle.",
    wins: "Closed key bugs.",
    blockers: "Waiting on review.",
    nextSteps: "Start next sprint.",
  });
});

test("supports the legacy camelCase next steps form key", () => {
  const formData = new FormData();
  formData.set("weekOf", "2026-04-18");
  formData.set("summary", "Wrapped up the main cycle.");
  formData.set("nextSteps", " Keep legacy clients working. ");

  assert.equal(
    getReviewFormValuesFromFormData(formData).nextSteps,
    "Keep legacy clients working.",
  );
});

test("maps stored review columns back into form defaults", () => {
  assert.deepEqual(
    getReviewFormValuesFromRecord(
      {
        summary: "Summary",
        wins: "Wins",
        blockers: null,
        next_steps: "Next",
      },
      "2026-04-18",
    ),
    {
      weekOf: "2026-04-18",
      summary: "Summary",
      wins: "Wins",
      blockers: "",
      nextSteps: "Next",
    },
  );
});

test("maps empty optional fields to null for persistence", () => {
  assert.deepEqual(
    toWeekReviewWriteFields({
      ...getEmptyReviewFormValues("2026-04-18"),
      summary: "Ready to save",
    }),
    {
      summary: "Ready to save",
      wins: null,
      blockers: null,
      next_steps: null,
    },
  );
});
