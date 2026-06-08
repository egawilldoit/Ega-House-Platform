import assert from "node:assert/strict";
import test from "node:test";

import { isLinearTokenMissingError } from "./dashboard-data";

test("isLinearTokenMissingError recognises the 'token not configured' error", () => {
  assert.equal(
    isLinearTokenMissingError(new Error("Linear API token is not configured.")),
    true,
  );
});

test("isLinearTokenMissingError recognises the missing-env error from Phase E", () => {
  assert.equal(
    isLinearTokenMissingError(
      new Error("LINEAR_PROJECT_NAME env var is required in production (set it to your Linear project name)."),
    ),
    true,
  );
});

test("isLinearTokenMissingError returns false for unrelated errors", () => {
  assert.equal(isLinearTokenMissingError(new Error("network timeout")), false);
  assert.equal(isLinearTokenMissingError(new Error("")), false);
});

test("isLinearTokenMissingError returns false for non-Error values", () => {
  assert.equal(isLinearTokenMissingError(null), false);
  assert.equal(isLinearTokenMissingError(undefined), false);
  assert.equal(isLinearTokenMissingError("Linear API token is not configured."), false);
  assert.equal(isLinearTokenMissingError({ message: "Linear API token is not configured." }), false);
  assert.equal(isLinearTokenMissingError(42), false);
  assert.equal(isLinearTokenMissingError(true), false);
});
