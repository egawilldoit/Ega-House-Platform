import assert from "node:assert/strict";
import test from "node:test";

import {
  getGoalNextStepPreview,
  GOAL_NEXT_STEP_MAX_LENGTH,
  normalizeGoalNextStepInput,
  toGoalNextStepWriteValue,
} from "./goal-next-step";

test("normalizes an empty next step to null", () => {
  assert.deepEqual(normalizeGoalNextStepInput("   "), {
    value: null,
    error: null,
  });
});

test("trims and keeps a valid next step", () => {
  assert.deepEqual(normalizeGoalNextStepInput(" Ship integration checks. "), {
    value: "Ship integration checks.",
    error: null,
  });
});

test("maps create payload next step from form data", () => {
  const formData = new FormData();
  formData.set("next_step", " Draft launch checklist ");

  assert.deepEqual(toGoalNextStepWriteValue(formData), {
    value: "Draft launch checklist",
    error: null,
  });
});

test("maps updated next step value from form data", () => {
  const formData = new FormData();
  formData.set("next_step", "Close acceptance criteria.");

  assert.deepEqual(toGoalNextStepWriteValue(formData), {
    value: "Close acceptance criteria.",
    error: null,
  });
});

test("maps cleared next step value to null from form data", () => {
  const formData = new FormData();
  formData.set("next_step", "   ");

  assert.deepEqual(toGoalNextStepWriteValue(formData), {
    value: null,
    error: null,
  });
});

test("supports legacy camelCase next step form key", () => {
  const formData = new FormData();
  formData.set("nextStep", "Keep legacy clients stable.");

  assert.deepEqual(toGoalNextStepWriteValue(formData), {
    value: "Keep legacy clients stable.",
    error: null,
  });
});

test("rejects a next step that exceeds the configured max length", () => {
  assert.deepEqual(
    normalizeGoalNextStepInput("x".repeat(GOAL_NEXT_STEP_MAX_LENGTH + 1)),
    {
      value: null,
      error: `Next step must be ${GOAL_NEXT_STEP_MAX_LENGTH} characters or fewer.`,
    },
  );
});

test("returns null preview when next step is empty", () => {
  assert.equal(getGoalNextStepPreview("   "), null);
});

test("truncates long next step previews", () => {
  assert.equal(getGoalNextStepPreview("1234567890", 6), "123456…");
});
