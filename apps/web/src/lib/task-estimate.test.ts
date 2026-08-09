import assert from "node:assert/strict";
import test from "node:test";

import { formatTaskEstimate, normalizeTaskEstimateInput } from "./task-estimate";

test("normalizes empty estimate input to null", () => {
  assert.deepEqual(normalizeTaskEstimateInput(""), {
    value: null,
    error: null,
  });
});

test("accepts whole-minute estimates", () => {
  assert.deepEqual(normalizeTaskEstimateInput("90"), {
    value: 90,
    error: null,
  });
});

test("rejects fractional or non-numeric estimates", () => {
  assert.equal(
    normalizeTaskEstimateInput("1.5").error,
    "Estimate must be a whole number of minutes.",
  );
  assert.equal(
    normalizeTaskEstimateInput("about an hour").error,
    "Estimate must be a whole number of minutes.",
  );
});

test("formats minute estimates compactly", () => {
  assert.equal(formatTaskEstimate(null), null);
  assert.equal(formatTaskEstimate(0), "0m");
  assert.equal(formatTaskEstimate(45), "45m");
  assert.equal(formatTaskEstimate(60), "1h");
  assert.equal(formatTaskEstimate(135), "2h 15m");
});
