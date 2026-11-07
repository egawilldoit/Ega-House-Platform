import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PERSONAL_OPERATIONS,
  isPersonalOperations,
} from "../src/personal-operations";
import {
  DEFAULT_USER_PREFERENCES,
  isJobSearchReference,
  normalizeUserPreferences,
  parseUserPreferencesPatch,
} from "../src/preferences";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

test("default schedule keeps 48h weekly work and 450m weekly job search", () => {
  const targets = Object.values(DEFAULT_PERSONAL_OPERATIONS.targets);
  assert.equal(targets.reduce((sum, day) => sum + day.work, 0), 2880);
  assert.equal(targets.reduce((sum, day) => sum + day.jobSearch, 0), 450);
  assert.equal(Object.keys(DEFAULT_PERSONAL_OPERATIONS).length, 3);
  assert.equal(DEFAULT_USER_PREFERENCES.jobSearchReference, null);
  for (const day of ["monday", "tuesday", "wednesday", "thursday", "friday"] as const) {
    assert.deepEqual(DEFAULT_PERSONAL_OPERATIONS.targets[day], { work: 480, jobSearch: 90 });
  }
  for (const day of ["saturday", "sunday"] as const) {
    assert.deepEqual(DEFAULT_PERSONAL_OPERATIONS.targets[day], { work: 240, jobSearch: 0 });
  }
});

test("a legacy 3-key schedule keeps targets and guidance during normalization", () => {
  const legacy = JSON.parse(JSON.stringify(DEFAULT_PERSONAL_OPERATIONS)) as Record<string, unknown>;
  legacy.targets = {
    ...(legacy.targets as Record<string, unknown>),
    monday: { work: 600, jobSearch: 30 },
  };
  legacy.guidance = [
    { name: "Custom block", days: ["monday"], start: "07:00", end: "08:00", enabled: true },
  ];

  assert.equal(isPersonalOperations(legacy), true);
  const preferences = normalizeUserPreferences({ personalOperations: legacy });
  assert.deepEqual(preferences.personalOperations.targets.monday, { work: 600, jobSearch: 30 });
  assert.deepEqual(preferences.personalOperations.guidance, legacy.guidance);
  assert.equal(preferences.jobSearchReference, null);
});

test("the schedule rejects a 4-key or extra-key shape", () => {
  const withReference = {
    ...DEFAULT_PERSONAL_OPERATIONS,
    jobSearchReference: { kind: "task", id: TASK_ID },
  };
  assert.equal(isPersonalOperations(withReference), false);
  assert.equal(parseUserPreferencesPatch({ personalOperations: withReference }).ok, false);
  assert.equal(
    parseUserPreferencesPatch({ personalOperations: { ...DEFAULT_PERSONAL_OPERATIONS, extra: true } }).ok,
    false,
  );
});

test("task-only job-search references validate exactly", () => {
  assert.equal(isJobSearchReference({ kind: "task", id: TASK_ID }), true);
  for (const invalid of [
    { kind: "project", id: PROJECT_ID },
    { kind: "goal", id: TASK_ID },
    { kind: "task", id: "not-a-uuid" },
    { kind: "task", id: `${TASK_ID}x` },
    { kind: "task", id: TASK_ID, title: "Job search" },
    { kind: "task" },
    { id: TASK_ID },
    "task",
    null,
  ]) {
    assert.equal(isJobSearchReference(invalid), false, JSON.stringify(invalid));
  }
});

test("the top-level reference defaults to null and normalizes per field", () => {
  assert.deepEqual(normalizeUserPreferences(null), DEFAULT_USER_PREFERENCES);
  assert.equal(
    normalizeUserPreferences({ jobSearchReference: { kind: "project", id: PROJECT_ID } }).jobSearchReference,
    null,
  );
  assert.deepEqual(
    normalizeUserPreferences({ jobSearchReference: { kind: "task", id: TASK_ID } }).jobSearchReference,
    { kind: "task", id: TASK_ID },
  );
});

test("a patch round-trips the top-level reference and can clear it", () => {
  const saved = parseUserPreferencesPatch({
    personalOperations: DEFAULT_PERSONAL_OPERATIONS,
    jobSearchReference: { kind: "task", id: TASK_ID },
  });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.deepEqual(saved.value.jobSearchReference, { kind: "task", id: TASK_ID });
  assert.equal(Object.keys(saved.value.personalOperations ?? {}).length, 3);

  const cleared = parseUserPreferencesPatch({ jobSearchReference: null });
  assert.equal(cleared.ok, true);
  if (!cleared.ok) return;
  assert.equal(cleared.value.jobSearchReference, null);
});

test("an invalid reference is rejected instead of silently cleared", () => {
  for (const reference of [
    { kind: "project", id: PROJECT_ID },
    { kind: "task", id: "bad" },
    { kind: "task", id: TASK_ID, extra: true },
  ]) {
    const result = parseUserPreferencesPatch({ jobSearchReference: reference });
    assert.equal(result.ok, false);
  }
});
