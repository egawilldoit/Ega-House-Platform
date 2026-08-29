import assert from "node:assert/strict";
import test from "node:test";

import { FRICTION_NEGLECTED_GOAL_WINDOW_DAYS, getFrictionNeglectedWindow } from "../src/friction/index";
import { getLocalDayWindow, getRollingLocalWindow } from "../src/time-context";

test("getRollingLocalWindow UTC 14-day normal", () => {
  const now = new Date("2026-04-22T12:00:00.000Z");
  const window = getRollingLocalWindow("UTC", now, 14);
  const expectedStart = getLocalDayWindow("UTC", "2026-04-08").startUtcIso;
  assert.equal(window.startIso, expectedStart);
  assert.equal(window.endIso, now.toISOString());
  assert.equal(expectedStart, "2026-04-08T00:00:00.000Z");
});

test("getRollingLocalWindow New York normal day", () => {
  const now = new Date("2026-01-15T12:00:00.000Z"); // 07:00 NY
  const window = getRollingLocalWindow("America/New_York", now, 14);
  const expectedStart = getLocalDayWindow("America/New_York", "2026-01-01").startUtcIso;
  assert.equal(window.startIso, expectedStart);
  assert.equal(expectedStart, "2026-01-01T05:00:00.000Z");
  assert.equal(window.endIso, now.toISOString());
});

test("getRollingLocalWindow Tokyo normal day", () => {
  const now = new Date("2026-01-14T15:00:00.000Z"); // 00:00 Tokyo 2026-01-15
  const window = getRollingLocalWindow("Asia/Tokyo", now, 14);
  const expectedStart = getLocalDayWindow("Asia/Tokyo", "2026-01-01").startUtcIso;
  assert.equal(window.startIso, expectedStart);
  assert.equal(expectedStart, "2025-12-31T15:00:00.000Z");
});

test("getRollingLocalWindow DST spring forward 23h day accounted", () => {
  // NY DST start 2026-03-08 is 23h; window spanning it should have correct start
  const now = new Date("2026-03-09T12:00:00.000Z"); // 08:00 NY after DST (UTC-4)
  const window = getRollingLocalWindow("America/New_York", now, 14);
  // localDate for now in NY is 2026-03-09, 14 days before is 2026-02-23
  const expectedStart = getLocalDayWindow("America/New_York", "2026-02-23").startUtcIso;
  assert.equal(window.startIso, expectedStart);
  assert.ok(window.startIso < window.endIso);
});

test("getRollingLocalWindow DST fall back 25h day accounted", () => {
  const now = new Date("2026-11-02T12:00:00.000Z"); // 07:00 NY after fallback (UTC-5)
  const window = getRollingLocalWindow("America/New_York", now, 14);
  const expectedStart = getLocalDayWindow("America/New_York", "2026-10-19").startUtcIso;
  assert.equal(window.startIso, expectedStart);
  assert.equal(expectedStart, "2026-10-19T04:00:00.000Z");
});

test("getRollingLocalWindow server TZ independence", () => {
  const originalTz = process.env.TZ;
  try {
    const now = new Date("2026-01-15T12:00:00.000Z");
    process.env.TZ = "Asia/Tokyo";
    const w1 = getRollingLocalWindow("America/New_York", now, 14);
    process.env.TZ = "UTC";
    const w2 = getRollingLocalWindow("America/New_York", now, 14);
    process.env.TZ = "America/Los_Angeles";
    const w3 = getRollingLocalWindow("America/New_York", now, 14);
    assert.deepEqual(w1, w2);
    assert.deepEqual(w2, w3);
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }
});

test("getFrictionNeglectedWindow uses 14 days and is local", () => {
  const now = new Date("2026-04-22T12:00:00.000Z");
  const w = getFrictionNeglectedWindow("UTC", now);
  const expected = getRollingLocalWindow("UTC", now, FRICTION_NEGLECTED_GOAL_WINDOW_DAYS);
  assert.deepEqual(w, expected);
  assert.equal(FRICTION_NEGLECTED_GOAL_WINDOW_DAYS, 14);
});

test("getRollingLocalWindow validates inputs", () => {
  assert.throws(() => getRollingLocalWindow("UTC", new Date("invalid"), 14), /Invalid now/);
  assert.throws(() => getRollingLocalWindow("UTC", new Date("2026-01-01T00:00:00Z"), 0), /Invalid windowDays/);
  assert.throws(() => getRollingLocalWindow("UTC", new Date("2026-01-01T00:00:00Z"), -1), /Invalid windowDays/);
});
