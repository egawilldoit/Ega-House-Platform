import assert from "node:assert/strict";
import test from "node:test";

import { normalizeStoredScopes, parseRequestedScopes } from "@/lib/services/agent-token-scopes";

// ---- normalizeStoredScopes (deny-by-default for DB values) ----

test("normalizeStoredScopes preserves valid scopes", () => {
  const result = normalizeStoredScopes({
    tasks: { read: true, create: true, bulkLimit: 10, idempotency: "source+sourceId" },
    projects: { read: true },
    goals: { read: false },
  });

  assert.equal(result.tasks?.read, true);
  assert.equal(result.tasks?.create, true);
  assert.equal(result.tasks?.bulkLimit, 10);
  assert.equal(result.tasks?.idempotency, "source+sourceId");
  assert.equal(result.projects?.read, true);
  assert.equal(result.goals?.read, undefined); // false is treated as absent
});

test("normalizeStoredScopes denies by default for missing scopes", () => {
  const result = normalizeStoredScopes({});
  assert.equal(result.tasks, undefined);
  assert.equal(result.projects, undefined);
  assert.equal(result.goals, undefined);
});

test("normalizeStoredScopes returns empty for null input", () => {
  const result = normalizeStoredScopes(null);
  assert.deepEqual(result, {});
});

test("normalizeStoredScopes returns empty for non-object input", () => {
  assert.deepEqual(normalizeStoredScopes("string"), {});
  assert.deepEqual(normalizeStoredScopes(42), {});
  assert.deepEqual(normalizeStoredScopes([]), {});
});

test("normalizeStoredScopes preserves valid bulkLimit, omits invalid", () => {
  const valid = normalizeStoredScopes({ tasks: { bulkLimit: 25 } });
  assert.equal(valid.tasks?.bulkLimit, 25);

  const tooLow = normalizeStoredScopes({ tasks: { bulkLimit: 0 } });
  assert.equal(tooLow.tasks?.bulkLimit, undefined);

  const tooHigh = normalizeStoredScopes({ tasks: { bulkLimit: 51 } });
  assert.equal(tooHigh.tasks?.bulkLimit, undefined);

  const nonInt = normalizeStoredScopes({ tasks: { bulkLimit: 1.5 } });
  assert.equal(nonInt.tasks?.bulkLimit, undefined);
});

test("normalizeStoredScopes preserves valid idempotency, omits invalid", () => {
  const valid = normalizeStoredScopes({ tasks: { idempotency: "source+sourceId" } });
  assert.equal(valid.tasks?.idempotency, "source+sourceId");

  const invalid = normalizeStoredScopes({ tasks: { idempotency: "something-else" } });
  assert.equal(invalid.tasks?.idempotency, undefined);
});

test("normalizeStoredScopes coerces non-boolean values", () => {
  const result = normalizeStoredScopes({
    tasks: { read: 1, create: "true", updateAny: null, archive: undefined },
  });
  // Only exactly `true` should pass
  assert.equal(result.tasks?.read, undefined);
  assert.equal(result.tasks?.create, undefined);
  assert.equal(result.tasks?.updateAny, undefined);
  assert.equal(result.tasks?.archive, undefined);
});

// ---- parseRequestedScopes (strict validation for CLI/token creation) ----

test("parseRequestedScopes accepts valid scopes", () => {
  const result = parseRequestedScopes({
    tasks: { read: true, create: false, bulkLimit: 10, idempotency: "source+sourceId" },
    projects: { read: true },
    goals: { read: false },
  });

  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.scopes.tasks?.read, true);
    assert.equal(result.scopes.tasks?.create, false);
    assert.equal(result.scopes.tasks?.bulkLimit, 10);
    assert.equal(result.scopes.tasks?.idempotency, "source+sourceId");
    assert.equal(result.scopes.projects?.read, true);
    assert.equal(result.scopes.goals?.read, false);
  }
});

test("parseRequestedScopes accepts empty object (explicitly empty scopes)", () => {
  const result = parseRequestedScopes({});
  assert.ok(result.ok);
});

test("parseRequestedScopes rejects null and undefined", () => {
  assert.equal(parseRequestedScopes(null).ok, false);
  assert.equal(parseRequestedScopes(undefined).ok, false);
});

test("parseRequestedScopes rejects non-object input", () => {
  assert.equal(parseRequestedScopes("string").ok, false);
  assert.equal(parseRequestedScopes(42).ok, false);
  assert.equal(parseRequestedScopes([]).ok, false);
});

test("parseRequestedScopes rejects unknown top-level keys", () => {
  const result = parseRequestedScopes({ unknownKey: true } as Record<string, unknown>);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /unknown scope key/);
});

test("parseRequestedScopes rejects unknown task keys", () => {
  const result = parseRequestedScopes({ tasks: { unknownTaskKey: true } });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /unknown tasks scope key/);
});

test("parseRequestedScopes rejects wrong types for boolean fields", () => {
  const result = parseRequestedScopes({ tasks: { read: "true" } });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /tasks\.read must be a boolean/);
});

test("parseRequestedScopes validates bulkLimit range", () => {
  assert.equal(parseRequestedScopes({ tasks: { bulkLimit: 0 } }).ok, false);
  assert.equal(parseRequestedScopes({ tasks: { bulkLimit: 51 } }).ok, false);
  assert.equal(parseRequestedScopes({ tasks: { bulkLimit: 1.5 } }).ok, false);
  assert.equal(parseRequestedScopes({ tasks: { bulkLimit: "10" } }).ok, false);
  assert.ok(parseRequestedScopes({ tasks: { bulkLimit: 1 } }).ok);
  assert.ok(parseRequestedScopes({ tasks: { bulkLimit: 50 } }).ok);
});

test("parseRequestedScopes validates idempotency literal", () => {
  const bad = parseRequestedScopes({ tasks: { idempotency: "x" } });
  assert.equal(bad.ok, false);

  const good = parseRequestedScopes({ tasks: { idempotency: "source+sourceId" } });
  assert.ok(good.ok);
});

test("parseRequestedScopes rejects unknown project/goal keys", () => {
  const projBad = parseRequestedScopes({ projects: { read: true, write: true } });
  assert.equal(projBad.ok, false);

  const goalsBad = parseRequestedScopes({ goals: { read: true, delete: true } });
  assert.equal(goalsBad.ok, false);
});
