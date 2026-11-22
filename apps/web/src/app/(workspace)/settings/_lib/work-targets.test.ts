import assert from "node:assert/strict";
import test from "node:test";

import { DAYS, DEFAULT_PERSONAL_OPERATIONS } from "@ega/domain/preferences";

import {
  getWeeklyTargetTotals,
  minutesToHoursValue,
  parseHoursToMinutes,
  parseWorkTargetsForm,
} from "./work-targets";

function formFromDefaults(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const day of DAYS) {
    data.set(`work-${day}`, minutesToHoursValue(DEFAULT_PERSONAL_OPERATIONS.targets[day].work));
    data.set(`jobSearch-${day}`, minutesToHoursValue(DEFAULT_PERSONAL_OPERATIONS.targets[day].jobSearch));
  }
  for (const [key, value] of Object.entries(overrides)) data.set(key, value);
  return data;
}

test("hours inputs round once into persisted whole minutes", () => {
  assert.equal(minutesToHoursValue(480), "8");
  assert.equal(minutesToHoursValue(90), "1.5");
  assert.equal(minutesToHoursValue(450), "7.5");
  assert.equal(parseHoursToMinutes("8"), 480);
  assert.equal(parseHoursToMinutes("7.5"), 450);
  assert.equal(parseHoursToMinutes("0.25"), 15);
  assert.equal(parseHoursToMinutes("24"), 1440);
});

test("rejects empty, out-of-range and non-numeric hours", () => {
  for (const value of ["", " ", "-1", "24.01", "abc", null]) {
    assert.equal(parseHoursToMinutes(value), null);
  }
});

test("parses a complete target form and carries the paused flag", () => {
  const result = parseWorkTargetsForm(
    formFromDefaults({ paused: "on", "work-monday": "6" }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.paused, true);
  assert.deepEqual(result.targets.monday, { work: 360, jobSearch: 90 });
  assert.deepEqual(result.targets.saturday, { work: 240, jobSearch: 0 });
});

test("rejects a bad day without partially accepting the rest", () => {
  const result = parseWorkTargetsForm(
    formFromDefaults({ "work-wednesday": "25" }),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.message, /wednesday work target/);
});

test("weekly totals are derived from persisted minutes", () => {
  assert.deepEqual(
    getWeeklyTargetTotals(DEFAULT_PERSONAL_OPERATIONS.targets),
    { work: 2880, jobSearch: 450 },
  );
});
