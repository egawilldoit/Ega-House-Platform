import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_ERROR_CODES,
  isAuthErrorCode,
  type AuthenticatedIdentity,
} from "../src/index";

test("shared auth identity and error codes stay platform neutral", () => {
  const identity: AuthenticatedIdentity = { id: "user-1", email: "u@example.com" };
  assert.deepEqual(identity, { id: "user-1", email: "u@example.com" });
  assert.deepEqual(AUTH_ERROR_CODES, ["UNAUTHENTICATED", "INVALID_CREDENTIALS", "SESSION_EXPIRED"]);
  assert.equal(isAuthErrorCode("SESSION_EXPIRED"), true);
  assert.equal(isAuthErrorCode("FORBIDDEN"), false);
});
