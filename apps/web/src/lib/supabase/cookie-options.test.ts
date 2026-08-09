import test from "node:test";
import assert from "node:assert/strict";

import { getSupabaseCookieOptions } from "./cookie-options";

test("uses shared domain cookie options on production root domain", () => {
  const options = getSupabaseCookieOptions("egawilldoit.online");

  assert.equal(options.domain, ".egawilldoit.online");
  assert.equal(options.secure, true);
  assert.equal(options.path, "/");
  assert.equal(options.sameSite, "lax");
});

test("uses shared domain cookie options on production subdomain", () => {
  const options = getSupabaseCookieOptions("tasks.egawilldoit.online");

  assert.equal(options.domain, ".egawilldoit.online");
  assert.equal(options.secure, true);
});

test("does not set production domain on localhost", () => {
  const options = getSupabaseCookieOptions("localhost:3000");

  assert.equal(options.domain, undefined);
  assert.equal(options.secure, undefined);
  assert.equal(options.path, "/");
  assert.equal(options.sameSite, "lax");
});
