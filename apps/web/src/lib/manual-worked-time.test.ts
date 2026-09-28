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
    timezone: "UTC",
  });

  assert.equal(result.error, "Both From and To are required to log worked time.");
  assert.equal(result.payload, null);
});

test("manual worked time rejects To only", () => {
  const result = normalizeManualWorkedTimeInput({
    startedAt: "",
    endedAt: "2026-04-30T10:00",
    timezone: "UTC",
  });

  assert.equal(result.error, "Both From and To are required to log worked time.");
  assert.equal(result.payload, null);
});

test("manual worked time rejects reversed interval", () => {
  const result = normalizeManualWorkedTimeInput({
    startedAt: "2026-04-30T10:00",
    endedAt: "2026-04-30T09:00",
    timezone: "UTC",
  });

  assert.equal(result.error, "To must be after From.");
  assert.equal(result.payload, null);
});

test("manual worked time rejects equal interval", () => {
  const result = normalizeManualWorkedTimeInput({
    startedAt: "2026-04-30T10:00",
    endedAt: "2026-04-30T10:00",
    timezone: "UTC",
  });

  assert.equal(result.error, "To must be after From.");
  assert.equal(result.payload, null);
});

test("manual worked time requires a timezone with complete datetime input", () => {
  const result = normalizeManualWorkedTimeInput({
    startedAt: "2026-04-30T09:15",
    endedAt: "2026-04-30T10:45",
  });

  assert.equal(result.error, "Worked time timezone is required.");
  assert.equal(result.payload, null);
});

test("manual worked time rejects an invalid IANA timezone", () => {
  const result = normalizeManualWorkedTimeInput({
    startedAt: "2026-04-30T09:00",
    endedAt: "2026-04-30T10:00",
    timezone: "UTC+1",
  });

  assert.match(result.error ?? "", /Invalid IANA timezone/);
  assert.equal(result.payload, null);
});

test("manual worked time converts datetime-local wall time in the account zone", () => {
  // Asia/Tokyo is UTC+9 with no DST: 09:15 JST == 00:15 UTC.
  const result = normalizeManualWorkedTimeInput({
    startedAt: "2026-04-30T09:15",
    endedAt: "2026-04-30T10:45",
    timezone: "Asia/Tokyo",
  });

  assert.equal(result.error, null);
  assert.deepEqual(result.payload, {
    started_at: "2026-04-30T00:15:00.000Z",
    ended_at: "2026-04-30T01:45:00.000Z",
    duration_seconds: 5400,
  });
});

test("manual worked time converts wall time across DST rules", () => {
  // America/New_York 2026-01-15 is EST (UTC-5).
  const winter = normalizeManualWorkedTimeInput({
    startedAt: "2026-01-15T09:15",
    endedAt: "2026-01-15T10:45",
    timezone: "America/New_York",
  });
  assert.deepEqual(winter.payload, {
    started_at: "2026-01-15T14:15:00.000Z",
    ended_at: "2026-01-15T15:45:00.000Z",
    duration_seconds: 5400,
  });

  // America/New_York 2026-07-15 is EDT (UTC-4).
  const summer = normalizeManualWorkedTimeInput({
    startedAt: "2026-07-15T09:15",
    endedAt: "2026-07-15T10:45",
    timezone: "America/New_York",
  });
  assert.deepEqual(summer.payload, {
    started_at: "2026-07-15T13:15:00.000Z",
    ended_at: "2026-07-15T14:45:00.000Z",
    duration_seconds: 5400,
  });
});

test("manual worked time rejects impossible wall times in the DST gap", () => {
  // 2026-03-08 02:30 does not exist in America/New_York (spring forward).
  const result = normalizeManualWorkedTimeInput({
    startedAt: "2026-03-08T02:30",
    endedAt: "2026-03-08T03:30",
    timezone: "America/New_York",
  });

  assert.match(result.error ?? "", /does not exist/);
  assert.equal(result.payload, null);
});

test("manual worked time rejects invalid calendar dates", () => {
  const result = normalizeManualWorkedTimeInput({
    startedAt: "2026-02-30T09:00",
    endedAt: "2026-02-30T10:00",
    timezone: "UTC",
  });

  assert.match(result.error ?? "", /Invalid date/);
  assert.equal(result.payload, null);
});

test("manual worked time ignores process timezone (TZ-invariance)", () => {
  const result = normalizeManualWorkedTimeInput({
    startedAt: "2026-04-30T09:15",
    endedAt: "2026-04-30T10:45",
    timezone: "Africa/Casablanca",
  });

  assert.equal(result.error, null);
  assert.deepEqual(result.payload, {
    started_at: "2026-04-30T08:15:00.000Z",
    ended_at: "2026-04-30T09:45:00.000Z",
    duration_seconds: 5400,
  });
});
