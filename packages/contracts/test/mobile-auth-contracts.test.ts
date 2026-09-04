import assert from "node:assert/strict";
import test from "node:test";

import {
  isMobileAuthRefreshResponse,
  isMobileAuthSessionResponse,
} from "../src/mobile";

const SESSION = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresAt: 1_800_000_000,
};

test("mobile auth guards accept the server response shapes", () => {
  assert.equal(
    isMobileAuthSessionResponse({
      ok: true,
      user: { id: "user-1", email: "user@example.com" },
      session: SESSION,
    }),
    true,
  );
  assert.equal(
    isMobileAuthRefreshResponse({ ok: true, session: SESSION }),
    true,
  );
});

test("mobile auth guards reject incomplete session payloads", () => {
  assert.equal(isMobileAuthSessionResponse({ ok: true, session: SESSION }), false);
  assert.equal(isMobileAuthRefreshResponse({ ok: true }), false);
  assert.equal(
    isMobileAuthRefreshResponse({
      ok: true,
      session: { ...SESSION, accessToken: "" },
    }),
    false,
  );
  assert.equal(
    isMobileAuthRefreshResponse({
      ok: true,
      session: { ...SESSION, expiresAt: Number.NaN },
    }),
    false,
  );
});
