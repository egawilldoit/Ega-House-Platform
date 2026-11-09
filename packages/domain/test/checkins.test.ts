import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeDailyCheckinPatch,
  parseDailyCheckinIdentity,
  parseDailyCheckinPatch,
  validateDailyCheckinRecord,
  type DailyCheckin,
} from "../src/checkins";

test("patch parses bounded qualitative fields and clears with null", () => {
  const result = parseDailyCheckinPatch({
    outcomes: "Shipped the planner",
    personalMinutes: 45,
    notes: "",
    overtimeMinutes: 30,
    overtimeReason: "Release window",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.outcomes, "Shipped the planner");
  assert.equal(result.value.personalMinutes, 45);
  assert.equal(result.value.notes, null);
  assert.equal(result.value.overtimeMinutes, 30);
  assert.equal(result.value.overtimeReason, "Release window");
});

test("patch rejects out-of-range minutes, overlong text and wrong types", () => {
  assert.equal(parseDailyCheckinPatch({ personalMinutes: 1441 }).ok, false);
  assert.equal(parseDailyCheckinPatch({ personalMinutes: -1 }).ok, false);
  assert.equal(parseDailyCheckinPatch({ personalMinutes: 1.5 }).ok, false);
  assert.equal(parseDailyCheckinPatch({ outcomes: "x".repeat(501) }).ok, false);
  assert.equal(parseDailyCheckinPatch({ notes: "x".repeat(1001) }).ok, false);
  assert.equal(parseDailyCheckinPatch({ overtimeReason: "x".repeat(301) }).ok, false);
  assert.equal(parseDailyCheckinPatch("nope").ok, false);
  assert.equal(parseDailyCheckinPatch(null).ok, false);
});

test("identity requires a real calendar date and a valid IANA zone", () => {
  assert.equal(parseDailyCheckinIdentity({ localDate: "2026-02-30", timezone: "UTC" }).ok, false);
  assert.equal(parseDailyCheckinIdentity({ localDate: "2026-02-16", timezone: "Not/AZone" }).ok, false);
  const ok = parseDailyCheckinIdentity({ localDate: "2026-02-16", timezone: "Africa/Casablanca" });
  assert.equal(ok.ok, true);
});

test("merged record: overtime without a reason is rejected, with reason passes", () => {
  assert.equal(
    validateDailyCheckinRecord({ overtimeMinutes: 30, overtimeReason: null }).ok,
    false,
  );
  assert.equal(
    validateDailyCheckinRecord({ overtimeMinutes: 30, overtimeReason: "  " }).ok,
    false,
  );
  assert.equal(
    validateDailyCheckinRecord({ overtimeMinutes: 30, overtimeReason: "Release" }).ok,
    true,
  );
  assert.equal(
    validateDailyCheckinRecord({ overtimeMinutes: 0, overtimeReason: null }).ok,
    true,
  );
  assert.equal(
    validateDailyCheckinRecord({ overtimeMinutes: null, overtimeReason: null }).ok,
    true,
  );
});

test("merge preserves omitted fields, clears explicit null, keeps timezone snapshot", () => {
  const existing: DailyCheckin = {
    localDate: "2026-02-16",
    timezone: "Africa/Casablanca",
    outcomes: "Old outcome",
    personalMinutes: 30,
    notes: "keep me",
    overtimeMinutes: null,
    overtimeReason: null,
    createdAt: "2026-02-16T20:00:00.000Z",
    updatedAt: "2026-02-16T20:00:00.000Z",
  };
  const merged = mergeDailyCheckinPatch(
    existing,
    { outcomes: "New outcome", notes: null },
    { localDate: "2026-02-16", timezone: "Europe/Berlin" },
    "2026-02-16T21:00:00.000Z",
  );
  assert.equal(merged.outcomes, "New outcome");
  assert.equal(merged.notes, null);
  assert.equal(merged.personalMinutes, 30);
  assert.equal(merged.createdAt, existing.createdAt);
  assert.equal(merged.updatedAt, "2026-02-16T21:00:00.000Z");
  assert.equal(merged.timezone, "Europe/Berlin");
});
