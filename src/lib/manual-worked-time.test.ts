import assert from "node:assert/strict";
import test from "node:test";

import { normalizeManualWorkedTimeInput } from "./manual-worked-time";

test("manual worked time accepts both fields blank", () => {
  const result = normalizeManualWorkedTimeInput({ startedAt: "", endedAt: "" });

  assert.equal(result.error, null);
  assert.equal(result.payload, null);
});

test("manual worked time rejects From only", () => {
  const result = normalizeManualWorkedTimeInput({
    startedAt: "2026-04-30T09:00",
    endedAt: "",
  });

  assert.equal(result.error, "Both From and To are required to log worked time.");
  assert.equal(result.payload, null);
});

test("manual worked time rejects To only", () => {
  const result = normalizeManualWorkedTimeInput({
    startedAt: "",
    endedAt: "2026-04-30T10:00",
  });

  assert.equal(result.error, "Both From and To are required to log worked time.");
  assert.equal(result.payload, null);
});

test("manual worked time rejects reversed interval", () => {
  const result = normalizeManualWorkedTimeInput({
    startedAt: "2026-04-30T10:00",
    endedAt: "2026-04-30T09:00",
  });

  assert.equal(result.error, "To must be after From.");
  assert.equal(result.payload, null);
});

test("manual worked time rejects equal interval", () => {
  const result = normalizeManualWorkedTimeInput({
    startedAt: "2026-04-30T10:00",
    endedAt: "2026-04-30T10:00",
  });

  assert.equal(result.error, "To must be after From.");
  assert.equal(result.payload, null);
});

test("manual worked time normalizes datetime-local input", () => {
  const result = normalizeManualWorkedTimeInput({
    startedAt: "2026-04-30T09:15",
    endedAt: "2026-04-30T10:45",
  });

  assert.equal(result.error, null);
  assert.deepEqual(result.payload, {
    started_at: new Date("2026-04-30T09:15").toISOString(),
    ended_at: new Date("2026-04-30T10:45").toISOString(),
    duration_seconds: 5400,
  });
});
