import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActorFromIdentity } from "../src/index";

test("verified shared identity derives the application actor", () => {
  assert.deepEqual(
    createAuthenticatedActorFromIdentity({ id: " user-1 ", email: "u@example.com" }),
    { userId: "user-1" },
  );
});
