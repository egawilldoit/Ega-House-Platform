import assert from "node:assert/strict";
import test from "node:test";

import { buildTodayCheckinPatch, getTodayCheckinReturnPath } from "./today-checkin";

function formData(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

test("Finish day writes only to Today, preserving the open check-in surface", () => {
  assert.equal(getTodayCheckinReturnPath("/today?finishDay=1#finish-day"), "/today?finishDay=1#finish-day");
  assert.equal(getTodayCheckinReturnPath("/tasks"), "/today?finishDay=1#finish-day");
  assert.equal(getTodayCheckinReturnPath(undefined), "/today?finishDay=1#finish-day");
});

test("check-in payload keeps unknown routine fields unknown instead of zero", () => {
  const payload = buildTodayCheckinPatch(
    formData({
      outcomes: "Closed the loop",
      personalMinutes: "30",
      overtimeMinutes: "",
      notes: "",
      "routine.runMinutes": "25",
      "routine.runCompleted": "true",
      "routine.runSkipped": "",
    }),
  );

  assert.equal(payload.ok, true);
  if (!payload.ok) return;
  assert.deepEqual(payload.patch, {
    outcomes: "Closed the loop",
    personalMinutes: 30,
    notes: "",
    overtimeMinutes: null,
    overtimeReason: "",
    routine: {
      runMinutes: 25,
      runCompleted: true,
      runSkipped: null,
    },
  });
});

test("check-in payload rejects fractional minutes before any write", () => {
  const payload = buildTodayCheckinPatch(formData({ personalMinutes: "1.5" }));

  assert.equal(payload.ok, false);
  if (payload.ok) return;
  assert.equal(payload.errorMessage, "Use whole minutes for personal time and overtime.");
});
