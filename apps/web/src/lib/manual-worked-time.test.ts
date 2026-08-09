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
    timeZoneOffsetMinutes: "0",
  });

  assert.equal(result.error, "To must be after From.");
  assert.equal(result.payload, null);
});

test("manual worked time rejects equal interval", () => {
  const result = normalizeManualWorkedTimeInput({
    startedAt: "2026-04-30T10:00",
    endedAt: "2026-04-30T10:00",
    timeZoneOffsetMinutes: "0",
  });

  assert.equal(result.error, "To must be after From.");
  assert.equal(result.payload, null);
});

test("manual worked time normalizes datetime-local input", () => {
  const result = normalizeManualWorkedTimeInput({
    startedAt: "2026-04-30T09:15",
    endedAt: "2026-04-30T10:45",
    timeZoneOffsetMinutes: "0",
  });

  assert.equal(result.error, null);
  assert.deepEqual(result.payload, {
    started_at: "2026-04-30T09:15:00.000Z",
    ended_at: "2026-04-30T10:45:00.000Z",
    duration_seconds: 5400,
  });
});

test("manual worked time requires timezone offset with complete datetime input", () => {
  const result = normalizeManualWorkedTimeInput({
    startedAt: "2026-04-30T09:15",
    endedAt: "2026-04-30T10:45",
  });

  assert.equal(result.error, "Worked time timezone offset is required.");
  assert.equal(result.payload, null);
});

test("manual worked time converts browser-local datetime with offset", () => {
  const result = normalizeManualWorkedTimeInput({
    startedAt: "2026-04-30T09:15",
    endedAt: "2026-04-30T10:45",
    timeZoneOffsetMinutes: "240",
  });

  assert.equal(result.error, null);
  assert.deepEqual(result.payload, {
    started_at: "2026-04-30T13:15:00.000Z",
    ended_at: "2026-04-30T14:45:00.000Z",
    duration_seconds: 5400,
  });
});

test("manual worked time converts positive-offset browser-local datetime", () => {
  const result = normalizeManualWorkedTimeInput({
    startedAt: "2026-04-30T09:15",
    endedAt: "2026-04-30T10:45",
    timeZoneOffsetMinutes: "-60",
  });

  assert.equal(result.error, null);
  assert.deepEqual(result.payload, {
    started_at: "2026-04-30T08:15:00.000Z",
    ended_at: "2026-04-30T09:45:00.000Z",
    duration_seconds: 5400,
  });
});

test("manual worked time rejects invalid calendar dates", () => {
  const result = normalizeManualWorkedTimeInput({
    startedAt: "2026-02-30T09:00",
    endedAt: "2026-02-30T10:00",
    timeZoneOffsetMinutes: "0",
  });

  assert.equal(result.error, "From must be a valid date and time.");
  assert.equal(result.payload, null);
});

test("manual worked time rejects invalid timezone offset", () => {
  const result = normalizeManualWorkedTimeInput({
    startedAt: "2026-04-30T09:00",
    endedAt: "2026-04-30T10:00",
    timeZoneOffsetMinutes: "UTC+1",
  });

  assert.equal(result.error, "Worked time timezone offset is invalid.");
  assert.equal(result.payload, null);
});
