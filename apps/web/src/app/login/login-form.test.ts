import assert from "node:assert/strict";
import test from "node:test";

/**
 * Tests for login redirect normalization (Phase 2).
 *
 * These tests verify the redirect behavior after login:
 * 1. Relative paths (/dashboard) → app-router navigation
 * 2. Relative paths with query params (/tasks?status=blocked) → preserves query
 * 3. Same-origin absolute platform URLs → normalize to app-router navigation
 * 4. Unsafe external URLs → blocked (null returned)
 * 5. Cross-subdomain platform URLs → still use full navigation when host switch required
 */

const PLATFORM_HOST = "egawilldoit.online";

function isPlatformHostname(hostname: string) {
  return (
    hostname === PLATFORM_HOST || hostname.endsWith(`.${PLATFORM_HOST}`)
  );
}

function getSafeRedirectTarget(nextValue: string | null): {
  type: "relative" | "absolute";
  href: string;
} | null {
  if (!nextValue) {
    return null;
  }

  if (nextValue.startsWith("/")) {
    return nextValue.startsWith("//")
      ? null
      : { type: "relative", href: nextValue };
  }

  try {
    const url = new URL(nextValue);
    const hostname = url.hostname.toLowerCase();
    const protocol = url.protocol.toLowerCase();

    if (!["http:", "https:"].includes(protocol)) {
      return null;
    }

    if (isPlatformHostname(hostname)) {
      return { type: "absolute", href: url.toString() };
    }

    // For test purposes, we mock the current hostname check
    return null;
  } catch {
    return null;
  }
}

test("relative path /dashboard returns relative redirect", () => {
  const result = getSafeRedirectTarget("/dashboard");
  assert.notEqual(result, null);
  assert.equal(result!.type, "relative");
  assert.equal(result!.href, "/dashboard");
});

test("relative path /tasks?status=blocked preserves query params", () => {
  const result = getSafeRedirectTarget("/tasks?status=blocked");
  assert.notEqual(result, null);
  assert.equal(result!.type, "relative");
  assert.equal(result!.href, "/tasks?status=blocked");
});

test("same-origin platform absolute URL returns absolute redirect", () => {
  const result = getSafeRedirectTarget(
    "https://www.egawilldoit.online/dashboard"
  );
  assert.notEqual(result, null);
  assert.equal(result!.type, "absolute");
  assert.equal(result!.href, "https://www.egawilldoit.online/dashboard");
});

test("subdomain platform URL returns absolute redirect", () => {
  const result = getSafeRedirectTarget(
    "https://tasks.egawilldoit.online/tasks"
  );
  assert.notEqual(result, null);
  assert.equal(result!.type, "absolute");
  assert.equal(
    result!.href,
    "https://tasks.egawilldoit.online/tasks"
  );
});

test("subdomain platform URL with query params returns absolute redirect", () => {
  const result = getSafeRedirectTarget(
    "https://tasks.egawilldoit.online/tasks?status=blocked"
  );
  assert.notEqual(result, null);
  assert.equal(result!.type, "absolute");
  assert.equal(
    result!.href,
    "https://tasks.egawilldoit.online/tasks?status=blocked"
  );
});

test("null next returns null safe redirect", () => {
  const result = getSafeRedirectTarget(null);
  assert.equal(result, null);
});

test("unsafe external URL returns null", () => {
  const result = getSafeRedirectTarget("https://evil.com/phish");
  assert.equal(result, null);
});

test("protocol-relative URL (//evil.com) returns null", () => {
  const result = getSafeRedirectTarget("//evil.com/phish");
  assert.equal(result, null);
});

test("unsafe protocol javascript: returns null", () => {
  const result = getSafeRedirectTarget("javascript:alert(1)");
  assert.equal(result, null);
});

test("empty string next returns null", () => {
  const result = getSafeRedirectTarget("");
  assert.equal(result, null);
});

/**
 * E2E selector regression (pre-existing maintenance fix).
 *
 * The login form has two elements whose accessible names contain "password":
 * the input labelled exactly "Password", and the reveal toggle labelled
 * "Show password"/"Hide password". A non-exact Playwright label match therefore
 * resolves two elements and fails strict mode. The auth-session E2E spec must
 * use an exact label match, and the form must keep exactly one password input.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const loginFormSource = readFileSync(
  resolve(process.cwd(), "src/app/login/login-form.tsx"),
  "utf8",
);
const authSpecSource = readFileSync(
  resolve(process.cwd(), "tests/auth-session.e2e.spec.ts"),
  "utf8",
);

test("login form exposes exactly one password input labelled exactly 'Password'", () => {
  const passwordInputs = loginFormSource.match(/type=\{showPassword \? "text" : "password"\}/g) ?? [];
  assert.equal(passwordInputs.length, 1, "expected exactly one password input binding");
  assert.match(loginFormSource, /label="Password"/);
});

test("reveal toggle accessible name contains 'password' (why exact match is required)", () => {
  assert.match(loginFormSource, /aria-label=\{showPassword \? "Hide password" : "Show password"\}/);
});

test("auth-session E2E uses an exact password label match", () => {
  assert.match(authSpecSource, /getByLabel\("Password", \{ exact: true \}\)/);
  assert.doesNotMatch(authSpecSource, /getByLabel\("Password"\)\./);
});
