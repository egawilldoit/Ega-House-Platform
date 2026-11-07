import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PERSONAL_OPERATIONS,
  isJobSearchReference,
  isPersonalOperations,
  normalizePersonalOperations,
  type PersonalOperations,
} from "../src/personal-operations";
import { normalizeUserPreferences, parseUserPreferencesPatch } from "../src/preferences";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

function legacySchedule(): Record<string, unknown> {
  const { jobSearchReference: _ignored, ...legacy } = DEFAULT_PERSONAL_OPERATIONS;
  return JSON.parse(JSON.stringify(legacy)) as Record<string, unknown>;
}

test("default schedule keeps 48h weekly work and 450m weekly job search", () => {
  const targets = Object.values(DEFAULT_PERSONAL_OPERATIONS.targets);
  assert.equal(targets.reduce((sum, day) => sum + day.work, 0), 2880);
  assert.equal(targets.reduce((sum, day) => sum + day.jobSearch, 0), 450);
  assert.equal(DEFAULT_PERSONAL_OPERATIONS.jobSearchReference, null);
  // Weekday 8h/search 90m, weekend 4h/search 0.
  for (const day of ["monday", "tuesday", "wednesday", "thursday", "friday"] as const) {
    assert.deepEqual(DEFAULT_PERSONAL_OPERATIONS.targets[day], { work: 480, jobSearch: 90 });
  }
  for (const day of ["saturday", "sunday"] as const) {
    assert.deepEqual(DEFAULT_PERSONAL_OPERATIONS.targets[day], { work: 240, jobSearch: 0 });
  }
});

test("a legacy 3-key schedule is accepted and normalized without losing targets or guidance", () => {
  const legacy = legacySchedule();
  legacy.targets = {
    ...(legacy.targets as Record<string, unknown>),
    monday: { work: 600, jobSearch: 30 },
  };
  legacy.guidance = [
    { name: "Custom block", days: ["monday"], start: "07:00", end: "08:00", enabled: true },
  ];

  assert.equal(isPersonalOperations(legacy), true);
  const normalized = normalizePersonalOperations(legacy);
  assert.equal(normalized.jobSearchReference, null);
  assert.equal(Object.keys(normalized).length, 4);
  assert.deepEqual(normalized.targets.monday, { work: 600, jobSearch: 30 });
  assert.deepEqual(normalized.guidance, legacy.guidance);

  // Reading a legacy persisted row keeps the owner's schedule.
  const preferences = normalizeUserPreferences({ personalOperations: legacy });
  assert.deepEqual(preferences.personalOperations.targets.monday, { work: 600, jobSearch: 30 });
  assert.equal(preferences.personalOperations.jobSearchReference, null);
});

test("task and project references are accepted exactly as stable ids", () => {
  for (const reference of [
    { kind: "task" as const, id: TASK_ID },
    { kind: "project" as const, id: PROJECT_ID },
  ]) {
    assert.equal(isJobSearchReference(reference), true);
    const schedule: PersonalOperations = {
      ...DEFAULT_PERSONAL_OPERATIONS,
      jobSearchReference: reference,
    };
    assert.equal(isPersonalOperations(schedule), true);
    assert.deepEqual(normalizePersonalOperations(schedule).jobSearchReference, reference);
    assert.equal(parseUserPreferencesPatch({ personalOperations: schedule }).ok, true);
  }
});

test("null reference is accepted in the 4-key shape", () => {
  const schedule = { ...legacySchedule(), jobSearchReference: null };
  assert.equal(isPersonalOperations(schedule), true);
  assert.equal(normalizePersonalOperations(schedule).jobSearchReference, null);
});

test("invalid kinds, ids, extra keys, and partial reference objects are rejected", () => {
  const base = legacySchedule();
  const candidates: unknown[] = [
    { ...base, jobSearchReference: { kind: "goal", id: TASK_ID } },
    { ...base, jobSearchReference: { kind: "task", id: "not-a-uuid" } },
    { ...base, jobSearchReference: { kind: "task", id: `${TASK_ID}x` } },
    { ...base, jobSearchReference: { kind: "task", id: TASK_ID, title: "Job search" } },
    { ...base, jobSearchReference: { kind: "task" } },
    { ...base, jobSearchReference: { id: TASK_ID } },
    { ...base, jobSearchReference: "task" },
    { ...base, extra: true },
    { ...base, jobSearchReference: null, extra: true },
  ];

  for (const candidate of candidates) {
    assert.equal(isPersonalOperations(candidate), false, JSON.stringify(candidate));
    assert.equal(parseUserPreferencesPatch({ personalOperations: candidate }).ok, false);
  }
});

test("an invalid schedule normalizes to the documented defaults", () => {
  assert.deepEqual(normalizePersonalOperations(null), DEFAULT_PERSONAL_OPERATIONS);
  assert.deepEqual(
    normalizePersonalOperations({ ...legacySchedule(), extra: true }),
    DEFAULT_PERSONAL_OPERATIONS,
  );
});

test("a new save persists the complete 4-key schedule", () => {
  const legacy = legacySchedule();
  const result = parseUserPreferencesPatch({ personalOperations: legacy });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const saved = result.value.personalOperations;
  assert.ok(saved);
  assert.equal(Object.keys(saved).length, 4);
  assert.equal(saved.jobSearchReference, null);
  assert.deepEqual(saved.targets, DEFAULT_PERSONAL_OPERATIONS.targets);
});
