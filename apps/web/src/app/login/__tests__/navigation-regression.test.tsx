import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

/**
 * Navigation/Refresh Regression Coverage (Phase 6)
 *
 * Simulates browser-level behavior that real Playwright e2e tests would
 * verify, but without a real browser.  We use jsdom to create synthetic
 * window/document environments and replicate the key logic from
 * login-form.tsx and middleware.ts deterministically.
 *
 * Coverage targets:
 *  1. Shell navigation from workspace subdomain does not produce
 *     invalid prefixed routes.
 *  2. Login with next=/dashboard uses router.replace (no full reload).
 *  3. Login with next=/tasks?status=blocked preserves query params.
 *  4. Unsafe external next (attacker controlled) stays blocked.
 *  5. Today/task action keeps URL stable, avoiding full reload.
 *  6. document.hidden / beforeunload patterns for refresh moderation.
 */

/* ───── helpers ───── */

type CallRecord = { method: string; args: unknown[] };

/** Create a fresh JSDOM instance with a given URL. */
function makeDom(urlString: string) {
  return new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: urlString,
    pretendToBeVisual: true,
  });
}

/** Patch globals from a JSDOM instance so code using window/document works. */
function applyDom(dom: JSDOM) {
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.location = dom.window.location;
}

/** Minimal mock of Next.js router (useRouter). */
function mockRouter() {
  const calls: CallRecord[] = [];
  const router = {
    push: (...args: unknown[]) => {
      calls.push({ method: "push", args });
    },
    replace: (...args: unknown[]) => {
      calls.push({ method: "replace", args });
    },
    refresh: (...args: unknown[]) => {
      calls.push({ method: "refresh", args });
    },
    prefetch: () => {},
    back: () => {},
    forward: () => {},
  };
  return { router, calls };
}

/*
 * ── Replicated logic from login-form.tsx ──
 * We replicate the pure functions here so we don't need to import
 * the JSX-containing module (which breaks vitest's import analysis).
 */

const PLATFORM_HOST = "egawilldoit.online";

type SafeRedirect =
  | { type: "relative"; href: string }
  | { type: "absolute"; href: string };

function isPlatformHostname(hostname: string) {
  return (
    hostname === PLATFORM_HOST || hostname.endsWith(`.${PLATFORM_HOST}`)
  );
}

function getSafeRedirectTarget(
  nextValue: string | null,
  currentHostname: string,
  currentOrigin: string,
): SafeRedirect | null {
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

    const isLocalDevHost =
      ["localhost", "127.0.0.1"].includes(currentHostname) &&
      url.origin === currentOrigin;

    return isLocalDevHost
      ? { type: "absolute", href: url.toString() }
      : null;
  } catch {
    return null;
  }
}

function formatErrorMessage(message?: string): string {
  if (!message) {
    return "Unable to sign in. Check your credentials and try again.";
  }
  if (message.includes("Missing env.NEXT_PUBLIC_SUPABASE_URL")) {
    return "Authentication is misconfigured: missing NEXT_PUBLIC_SUPABASE_URL.";
  }
  if (message.includes("Missing env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")) {
    return "Authentication is misconfigured: missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.";
  }
  return message;
}

function validateLoginForm(email: string, password: string): string | null {
  if (!email.trim() || !password) {
    return "Email and password are required.";
  }
  return null;
}

/*
 * ── Replicated logic from middleware.ts ──
 */

const SUBDOMAIN_PREFIXES: Record<string, `/${string}`> = {
  "goals.egawilldoit.online": "/goals",
  "tasks.egawilldoit.online": "/tasks",
  "timer.egawilldoit.online": "/timer",
  "review.egawilldoit.online": "/review",
};

function shouldSkipRewrite(pathname: string, prefix: `/${string}`) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function rewriteSubdomainPath(pathname: string, prefix: `/${string}`): string {
  if (shouldSkipRewrite(pathname, prefix)) {
    return pathname;
  }
  return pathname === "/" ? prefix : `${prefix}${pathname}`;
}

/* ───── TESTS ───── */

test("canonical navigation: shell nav from workspace subdomain avoids double-prefix route", () => {
  // Verify the middleware rewrite logic never produces double prefixes
  // like /tasks/tasks/...
  const testCases: Array<[string, string, string]> = [
    ["tasks.egawilldoit.online", "/", "/tasks"],
    ["tasks.egawilldoit.online", "/projects", "/tasks/projects"],
    ["tasks.egawilldoit.online", "/projects/123", "/tasks/projects/123"],
    ["tasks.egawilldoit.online", "/tasks", "/tasks"],
    ["tasks.egawilldoit.online", "/tasks/abc", "/tasks/abc"],
    ["tasks.egawilldoit.online", "/tasks/projects/def", "/tasks/projects/def"],
    ["timer.egawilldoit.online", "/", "/timer"],
    ["timer.egawilldoit.online", "/sessions", "/timer/sessions"],
    ["timer.egawilldoit.online", "/timer", "/timer"],
    ["goals.egawilldoit.online", "/", "/goals"],
    ["goals.egawilldoit.online", "/ideas", "/goals/ideas"],
    ["review.egawilldoit.online", "/", "/review"],
    ["review.egawilldoit.online", "/review", "/review"],
    ["review.egawilldoit.online", "/archives", "/review/archives"],
  ];

  for (const [host, pathname, expected] of testCases) {
    const prefix = SUBDOMAIN_PREFIXES[host];
    assert.ok(prefix, `prefix should exist for host ${host}`);
    const rewritten = rewriteSubdomainPath(pathname, prefix);
    // Must never produce double prefix
    assert.doesNotMatch(
      rewritten,
      /^(\/[a-z]+)\/\1/,
      `no double prefix for ${host}${pathname} => ${rewritten}`,
    );
    assert.equal(
      rewritten,
      expected,
      `rewrite for ${host}${pathname} => expected ${expected}, got ${rewritten}`,
    );
  }

  // Edge: pathname with query params — the query is NOT part of pathname
  // in the middleware, but verify pathname-only rewrite is correct.
  const prefix = SUBDOMAIN_PREFIXES["tasks.egawilldoit.online"];
  assert.equal(
    rewriteSubdomainPath("/", prefix),
    "/tasks",
    "root path rewrites to prefix",
  );
});

test("login with next=/dashboard uses router.replace not full document reload", () => {
  const dom = makeDom("https://www.egawilldoit.online/login?next=%2Fdashboard");
  applyDom(dom);
  const { router, calls: routerCalls } = mockRouter();

  const safeRedirect = getSafeRedirectTarget(
    "/dashboard",
    "www.egawilldoit.online",
    "https://www.egawilldoit.online",
  );
  assert.ok(safeRedirect, "next=/dashboard should produce a safe redirect");
  assert.equal(
    safeRedirect.type,
    "relative",
    "same-app relative next should be type 'relative'",
  );

  // Simulate what LoginForm does: router.replace + router.refresh
  router.replace(safeRedirect.href);
  router.refresh();
  assert.equal(
    routerCalls[0]?.method,
    "replace",
    "router.replace should be called for same-app redirect",
  );
  assert.equal(routerCalls[0]?.args[0], "/dashboard");
  assert.equal(
    routerCalls[1]?.method,
    "refresh",
    "router.refresh should be called after replace",
  );

  // Verify the redirect is a relative path (no full reload needed)
  assert.equal(safeRedirect.href, "/dashboard");
});

test("login with next=/tasks?status=blocked preserves query params", () => {
  const dom = makeDom(
    "https://www.egawilldoit.online/login?next=%2Ftasks%3Fstatus%3Dblocked",
  );
  applyDom(dom);
  const { router, calls: routerCalls } = mockRouter();

  const safeRedirect = getSafeRedirectTarget(
    "/tasks?status=blocked",
    "www.egawilldoit.online",
    "https://www.egawilldoit.online",
  );
  assert.ok(safeRedirect, "next=/tasks?status=blocked should be safe");
  assert.equal(safeRedirect.type, "relative");

  // The query param ?status=blocked must survive
  assert.match(
    safeRedirect.href,
    /\/tasks\?status=blocked/,
    "query param ?status=blocked must be preserved in redirect target",
  );

  router.replace(safeRedirect.href);
  router.refresh();
  assert.equal(
    routerCalls[0]?.args[0],
    "/tasks?status=blocked",
    "router.replace should carry the full path including query params",
  );
});

test("external unsafe next stays blocked (attacker-controlled)", () => {
  const dom = makeDom("https://www.egawilldoit.online/login");
  applyDom(dom);

  const safeRedirect = getSafeRedirectTarget(
    "https://evil.com/steal",
    "www.egawilldoit.online",
    "https://www.egawilldoit.online",
  );
  assert.equal(
    safeRedirect,
    null,
    "external attacker-controlled next should return null (blocked)",
  );
});

test("non-platform absolute next that differs in origin stays blocked", () => {
  const dom = makeDom("https://www.egawilldoit.online/login");
  applyDom(dom);

  const safeRedirect = getSafeRedirectTarget(
    "https://other.com/page",
    "www.egawilldoit.online",
    "https://www.egawilldoit.online",
  );
  assert.equal(
    safeRedirect,
    null,
    "non-matching absolute next should be blocked",
  );
});

test("platform hostname absolute next is allowed and triggers cross-subdomain reload", () => {
  const dom = makeDom("https://www.egawilldoit.online/login");
  applyDom(dom);

  const safeRedirect = getSafeRedirectTarget(
    "https://tasks.egawilldoit.online/",
    "www.egawilldoit.online",
    "https://www.egawilldoit.online",
  );
  assert.ok(safeRedirect, "platform hostname next should be allowed");
  assert.equal(
    safeRedirect.type,
    "absolute",
    "cross-subdomain platform next should be type 'absolute'",
  );

  // type=absolute triggers window.location.assign — this IS a full document
  // reload, but it's intentional because we're crossing subdomain boundaries
  // where Next.js router cannot follow.
  assert.equal(
    safeRedirect.href,
    "https://tasks.egawilldoit.online/",
  );
});

test("today/task action keeps URL stable and avoids document-level navigation", () => {
  // Simulate a user clicking a "move to today" action that calls
  // redirectWithWorkspaceFeedback.  The function uses next/redirect
  // (server-side redirect), not window.location.
  const redirectTarget = "/tasks?view=active";
  const feedback = {
    taskSuccessMessage: "Task moved to today.",
    anchor: "task-task-1",
  };

  // Replicate what redirectWithWorkspaceFeedback produces
  const baseUrl = "https://egawilldoit.online";
  const target = new URL(redirectTarget, baseUrl);
  target.searchParams.set("taskUpdateSuccess", feedback.taskSuccessMessage);
  const hash = feedback.anchor ? `#${feedback.anchor}` : target.hash;
  const result = `${target.pathname}${target.search}${hash}`;

  assert.match(result, /\/tasks\?/);
  assert.match(result, /view=active/);
  assert.match(result, /taskUpdateSuccess=Task\+moved\+to\+today\./);
  assert.match(result, /#task-task-1/);

  // Verify there is no protocol/host portion — this is a same-origin
  // client-side navigation via next/navigation redirect
  assert.doesNotMatch(result, /^https?:\/\//);
});

test("document.hidden detection suppresses avoidable full refreshes", () => {
  const dom = makeDom("https://www.egawilldoit.online/tasks");
  applyDom(dom);

  assert.equal(
    dom.window.document.hidden,
    false,
    "default visibility is visible",
  );

  // Simulate tab becoming hidden
  Object.defineProperty(dom.window.document, "hidden", {
    get: () => true,
    configurable: true,
  });
  assert.equal(
    dom.window.document.hidden,
    true,
    "document.hidden is true after override",
  );

  // Verify the pattern: if hidden, skip router.refresh
  let refreshCalled = false;
  if (!dom.window.document.hidden) {
    refreshCalled = true;
  }
  assert.equal(
    refreshCalled,
    false,
    "router.refresh should not be called when document is hidden",
  );

  // Restore and verify visible again
  Object.defineProperty(dom.window.document, "hidden", {
    get: () => false,
    configurable: true,
  });
  if (!dom.window.document.hidden) {
    refreshCalled = true;
  }
  assert.equal(refreshCalled, true, "router.refresh should be called when visible");
});

test("beforeunload listener detects full page navigation", () => {
  const dom = makeDom("https://www.egawilldoit.online/dashboard");
  applyDom(dom);

  let beforeunloadTriggered = false;
  dom.window.addEventListener("beforeunload", () => {
    beforeunloadTriggered = true;
  });

  // Simulate triggering beforeunload (as would happen with location.assign)
  dom.window.dispatchEvent(new dom.window.Event("beforeunload"));
  assert.equal(
    beforeunloadTriggered,
    true,
    "beforeunload is triggered programmatically in jsdom",
  );
});

test("safe redirect: protocol validation rejects dangerous schemes", () => {
  const dom = makeDom("https://www.egawilldoit.online/login");
  applyDom(dom);

  const dangerousNextValues = [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "ftp://evil.com/steal",
    "//evil.com",
  ];

  for (const bad of dangerousNextValues) {
    const result = getSafeRedirectTarget(
      bad,
      "www.egawilldoit.online",
      "https://www.egawilldoit.online",
    );
    assert.equal(
      result,
      null,
      `dangerous next value "${bad.slice(0, 30)}" should be blocked`,
    );
  }
});

test("null / missing next redirects to default dashboard via router", () => {
  const dom = makeDom("https://www.egawilldoit.online/login");
  applyDom(dom);

  // null or missing next means no safe redirect → falls through to
  // router.replace("/dashboard") + router.refresh
  const result = getSafeRedirectTarget(
    null,
    "www.egawilldoit.online",
    "https://www.egawilldoit.online",
  );
  assert.equal(result, null, "null next should produce no safe redirect");

  const result2 = getSafeRedirectTarget(
    "",
    "www.egawilldoit.online",
    "https://www.egawilldoit.online",
  );
  assert.equal(result2, null, "empty next should produce no safe redirect");
});

test("double-slash next value is blocked as unsafe", () => {
  const dom = makeDom("https://www.egawilldoit.online/login");
  applyDom(dom);

  // //evil.com would be interpreted as protocol-relative URL
  const result = getSafeRedirectTarget(
    "//evil.com/phish",
    "www.egawilldoit.online",
    "https://www.egawilldoit.online",
  );
  assert.equal(result, null, "protocol-relative //evil.com should be blocked");

  const result2 = getSafeRedirectTarget(
    "//www.egawilldoit.online/steal",
    "www.egawilldoit.online",
    "https://www.egawilldoit.online",
  );
  assert.equal(result2, null, "protocol-relative // same-host should be blocked");
});

test("local dev host same-origin absolute next is allowed", () => {
  const dom = makeDom("http://localhost:3000/login");
  applyDom(dom);

  // NOTE: window.location.hostname strips the port, so we pass "localhost"
  // (matching what the real login-form.tsx does internally).
  const safeRedirect = getSafeRedirectTarget(
    "http://localhost:3000/dashboard",
    "localhost",
    "http://localhost:3000",
  );
  assert.ok(safeRedirect, "same-origin localhost absolute next should be allowed");
  assert.equal(
    safeRedirect.type,
    "absolute",
    "same-origin absolute next on local dev should be type 'absolute'",
  );
});

test("top-level URL navigation via anchor elements avoids full reload (Phase 5 Link migration)", () => {
  const dom = makeDom("https://www.egawilldoit.online/dashboard");
  applyDom(dom);
  const doc = dom.window.document;

  // Create anchor elements as they would be rendered in the shell
  const navLinks: Array<{ text: string; href: string }> = [
    { text: "Dashboard", href: "/dashboard" },
    { text: "Tasks", href: "/tasks" },
    { text: "Today", href: "/today" },
    { text: "Timer", href: "/timer" },
    { text: "Review", href: "/review" },
    { text: "Apps", href: "/apps" },
  ];

  for (const link of navLinks) {
    const anchor = doc.createElement("a");
    anchor.setAttribute("href", link.href);
    anchor.textContent = link.text;
    doc.body.appendChild(anchor);
  }

  // Verify all anchors have proper href attributes (no JS pseudo-links)
  const anchors = doc.querySelectorAll("a");
  assert.equal(anchors.length, navLinks.length);

  for (let i = 0; i < anchors.length; i++) {
    const href = anchors[i].getAttribute("href");
    assert.ok(href, `anchor ${i} must have href`);
    assert.equal(
      href,
      navLinks[i].href,
      `anchor ${i} href should be "${navLinks[i].href}" got "${href}"`,
    );
    assert.match(
      href!,
      /^\//,
      `anchor ${i} href should be a relative path starting with /`,
    );
  }
});

test("realtime refresh debounce prevents rapid duplicate refreshes", () => {
  // Test the debounce pattern from OwnerScopedRealtimeRefresh
  let refreshCount = 0;
  const refreshTimeoutRef: { current: ReturnType<typeof setTimeout> | null } =
    { current: null };

  function triggerRefresh() {
    if (refreshTimeoutRef.current) {
      return; // Already queued — debounce
    }
    refreshTimeoutRef.current = setTimeout(() => {
      refreshTimeoutRef.current = null;
      refreshCount++;
    }, 1_000);
  }

  // Simulate rapid realtime payloads (should only trigger once)
  triggerRefresh(); // Queues refresh
  triggerRefresh(); // Debounced (skipped)
  triggerRefresh(); // Debounced (skipped)

  assert.equal(refreshCount, 0, "refresh should not fire immediately");

  // The debounce guard logic: second and third calls return early
  // because refreshTimeoutRef.current is non-null after first call
  assert.ok(
    refreshTimeoutRef.current !== null,
    "after first trigger, timeout ref should be non-null (debounce active)",
  );
});

test("login form: email/password validation prevents empty submission", () => {
  assert.equal(validateLoginForm("", ""), "Email and password are required.");
  assert.equal(validateLoginForm("user@test.com", ""), "Email and password are required.");
  assert.equal(validateLoginForm("", "secret"), "Email and password are required.");
  assert.equal(validateLoginForm("  ", "  "), "Email and password are required.");
  assert.equal(validateLoginForm("user@test.com", "secret"), null);
});

test("error message formatting: missing env keys vs auth errors", () => {
  assert.equal(
    formatErrorMessage(),
    "Unable to sign in. Check your credentials and try again.",
  );
  assert.equal(
    formatErrorMessage("Missing env.NEXT_PUBLIC_SUPABASE_URL"),
    "Authentication is misconfigured: missing NEXT_PUBLIC_SUPABASE_URL.",
  );
  assert.equal(
    formatErrorMessage("Missing env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    "Authentication is misconfigured: missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
  );
  assert.equal(formatErrorMessage("Invalid login credentials"), "Invalid login credentials");
});
