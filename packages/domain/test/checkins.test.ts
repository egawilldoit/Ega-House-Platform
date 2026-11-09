import assert from "node:assert/strict";
import test from "node:test";

import {
  countWeeklyRunSessions,
  mergeDailyCheckinPatch,
  mergeRoutineMetrics,
  parseDailyCheckinIdentity,
  parseDailyCheckinPatch,
  parseRoutineMetrics,
  validateDailyCheckinRecord,
  type DailyCheckin,
  type RoutineMetrics,
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
    routine: null,
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

test("routine parser accepts bounded values and keeps unknown fields null", () => {
  const result = parseRoutineMetrics({
    runMinutes: 30,
    runCompleted: true,
    runSkipped: null,
    chessMinutes: 15,
    sleepHours: 7.5,
    leisureMinutes: 0,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, {
    runMinutes: 30,
    runCompleted: true,
    runSkipped: null,
    chessMinutes: 15,
    sleepHours: 7.5,
    leisureMinutes: 0,
  });
});

test("routine parser rejects unknown keys, fractional minutes and bad sleep steps", () => {
  assert.equal(parseRoutineMetrics({ unknown: 1 }).ok, false);
  assert.equal(parseRoutineMetrics({ runMinutes: 1.5 }).ok, false);
  assert.equal(parseRoutineMetrics({ runMinutes: -1 }).ok, false);
  assert.equal(parseRoutineMetrics({ runMinutes: 1441 }).ok, false);
  assert.equal(parseRoutineMetrics({ sleepHours: 7.25 }).ok, false);
  assert.equal(parseRoutineMetrics({ sleepHours: 25 }).ok, false);
  assert.equal(parseRoutineMetrics({ runCompleted: "yes" }).ok, false);
});

test("routine merge preserves omitted routine fields and clears on null", () => {
  const existing: RoutineMetrics = {
    runMinutes: 30, runCompleted: true, runSkipped: false,
    chessMinutes: null, sleepHours: null, leisureMinutes: 10,
  };
  const merged = mergeRoutineMetrics(existing, { leisureMinutes: 20 });
  assert.equal(merged?.runMinutes, 30);
  assert.equal(merged?.runCompleted, true);
  assert.equal(merged?.leisureMinutes, 20);
  assert.equal(mergeRoutineMetrics(existing, null), null);
  assert.equal(mergeRoutineMetrics(null, {}), null);
  assert.deepEqual(mergeRoutineMetrics(null, { leisureMinutes: 5 }), {
    runMinutes: null, runCompleted: null, runSkipped: null,
    chessMinutes: null, sleepHours: null, leisureMinutes: 5,
  });
});

test("patch carries routine field-wise and routine null clears only routine", () => {
  const withRoutine = parseDailyCheckinPatch({ routine: { runMinutes: 30, runCompleted: true } });
  assert.equal(withRoutine.ok, true);
  if (!withRoutine.ok) return;
  assert.deepEqual(withRoutine.value.routine, { runMinutes: 30, runCompleted: true });

  const cleared = parseDailyCheckinPatch({ routine: null });
  assert.equal(cleared.ok, true);
  if (!cleared.ok) return;
  assert.equal(cleared.value.routine, null);
});

test("weekly run count derives from explicit completions only", () => {
  const routine = (patch: Partial<RoutineMetrics>): RoutineMetrics => ({
    runMinutes: null, runCompleted: null, runSkipped: null,
    chessMinutes: null, sleepHours: null, leisureMinutes: null,
    ...patch,
  });
  const records = [
    { localDate: "2026-02-16", routine: routine({ runCompleted: true, runMinutes: 30 }) },
    { localDate: "2026-02-17", routine: routine({ runCompleted: true }) },
    { localDate: "2026-02-18", routine: routine({ runCompleted: false, runMinutes: 45 }) },
    { localDate: "2026-02-19", routine: routine({ runSkipped: true }) },
    { localDate: "2026-02-20", routine: null },
    { localDate: "2026-02-10", routine: routine({ runCompleted: true, runMinutes: 99 }) },
  ];
  const counted = countWeeklyRunSessions(records, "2026-02-16", "2026-02-22");
  assert.equal(counted.completedSessions, 2);
  assert.equal(counted.totalRunMinutes, 30);
});
