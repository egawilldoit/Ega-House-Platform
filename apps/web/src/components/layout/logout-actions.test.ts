import assert from "node:assert/strict";
import test from "node:test";

import { executeSignOut, resolveSignOutRedirectTarget } from "./logout-logic";

test("resolves sign-out redirect to root login host for protected subdomains", () => {
  assert.equal(
    resolveSignOutRedirectTarget("tasks.egawilldoit.online", "https"),
    "https://www.egawilldoit.online/login",
  );
});

test("resolves sign-out redirect to relative login on root and localhost hosts", () => {
  assert.equal(resolveSignOutRedirectTarget("www.egawilldoit.online", "https"), "/login");
  assert.equal(resolveSignOutRedirectTarget("egawilldoit.online", "https"), "/login");
  assert.equal(resolveSignOutRedirectTarget("localhost:3000", "http"), "/login");
});

test("executeSignOut clears auth session and returns redirect target", async () => {
  let called = false;

  const result = await executeSignOut({
    signOut: async () => {
      called = true;
      return { error: null };
    },
    requestHost: "review.egawilldoit.online",
    forwardedProto: "https",
  });

  assert.equal(called, true);
  assert.equal(result.error, null);
  assert.equal(result.redirectTo, "https://www.egawilldoit.online/login");
});

test("executeSignOut returns a safe error state when provider sign-out fails", async () => {
  const result = await executeSignOut({
    signOut: async () => ({
      error: { message: "network timeout" },
    }),
    requestHost: "www.egawilldoit.online",
    forwardedProto: "https",
  });

  assert.equal(result.redirectTo, null);
  assert.equal(result.error, "Unable to sign out right now. Please try again.");
});
