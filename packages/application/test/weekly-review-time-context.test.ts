import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor, type AuthenticatedActor } from "../src/auth/actor";
import type { RepositoryResult } from "../src/shared/result";
import type { TimeContextRepository } from "../src/shared/time-context";
import type {
  ExecutionEvidenceRepository,
  ExecutionEvidenceSessionRow,
  ExecutionEvidenceWindow,
} from "../src/shared/execution-evidence";
import { getWeeklyReviewReadModel } from "../src/weekly-review/read-model";
import type {
  WeeklyReviewRepository,
  WeeklyReviewTaskRepository,
} from "../src/weekly-review/ports";

// ---------------------------------------------------------------------------
// Fakes (minimal)
// ---------------------------------------------------------------------------

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

class FakeTimeContextRepo implements TimeContextRepository {
  constructor(private stored: string | null = "UTC") {}
  async getTimezone(): Promise<RepositoryResult<string | null>> {
    return ok(this.stored);
  }
  async setTimezone(_actor: AuthenticatedActor, tz: string): Promise<RepositoryResult<string>> {
    this.stored = tz;
    return ok(tz);
  }
}

class FakeWeeklyReviewRepo implements WeeklyReviewRepository {
  async getSavedReview() {
    return ok(null);
  }
  async listPastReviews() {
    return ok([]);
  }
  async getPreviousReview() {
    return ok(null);
  }
}

class FakeWeeklyTasksRepo implements WeeklyReviewTaskRepository {
  async countTasksCreatedForWindow() {
    return ok(0);
  }
  async listGoalsTouchedForWindow() {
    return ok([]);
  }
  async listBlockedTasks() {
    return ok([]);
  }
  async listCompletedTasksForWindow() {
    return ok([]);
  }
  async listCarriedTasksForWindow() {
    return ok([]);
  }
  async listBlockedTasksForWindow() {
    return ok([]);
  }
}

class FakeEvidenceRepo implements ExecutionEvidenceRepository {
  async listSessionsForWindow() {
    return ok([] as ExecutionEvidenceSessionRow[]);
  }
}

const ACTOR = createAuthenticatedActor("user-123");

function deps(timezone: string | null) {
  return {
    timeContext: new FakeTimeContextRepo(timezone),
    weeklyReview: new FakeWeeklyReviewRepo(),
    weeklyTasks: new FakeWeeklyTasksRepo(),
    executionEvidence: new FakeEvidenceRepo(),
  };
}

// ---------------------------------------------------------------------------
// 1. Asia/Tokyo early local hours (UTC previous day)
// ---------------------------------------------------------------------------

test("Tokyo 01:00 JST (UTC previous day) shows local Monday week, not UTC Sunday week", async () => {
  // 2026-01-12 is Monday. Tokyo Monday 00:30 JST = Sunday 15:30 UTC.
  // If using UTC authority, weekOf would be Sunday 2026-01-11 => week Mon 2026-01-05.
  // With canonical Time Context (Asia/Tokyo), local date is Monday 2026-01-12 => week Mon 2026-01-12.
  const now = new Date("2026-01-11T15:30:00.000Z"); // Tokyo Mon 00:30
  const result = await getWeeklyReviewReadModel(ACTOR, deps("Asia/Tokyo"), { now });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Should be week of Jan 12, not Jan 05
  assert.equal(result.data.window.weekStart, "2026-01-12");
  assert.equal(result.data.window.weekEnd, "2026-01-18");
  assert.equal(result.data.window.timezone, "Asia/Tokyo");
  assert.equal(result.data.window.weekStartUtc, "2026-01-11T15:00:00.000Z"); // Tokyo Mon 00:00 = Sun 15:00 UTC
});

test("Tokyo 01:00 on Tuesday still correct week", async () => {
  // Tuesday 01:00 JST = Monday 16:00 UTC previous day. Should still be same week (Mon 12-18)
  const now = new Date("2026-01-12T16:00:00.000Z"); // Tokyo Tue 01:00 Jan 13
  const result = await getWeeklyReviewReadModel(ACTOR, deps("Asia/Tokyo"), { now });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.window.weekStart, "2026-01-12");
  assert.equal(result.data.window.timezone, "Asia/Tokyo");
});

// ---------------------------------------------------------------------------
// 2. America/New_York near midnight
// ---------------------------------------------------------------------------

test("New York 23:30 Sunday (UTC Monday 04:30) stays in previous local week", async () => {
  // NY Sunday 2026-01-11 23:30 = UTC Mon 2026-01-12 04:30
  // UTC date would be Mon Jan 12 => week Mon 12, but NY local is still Sun Jan 11 => week Mon 05
  const now = new Date("2026-01-12T04:30:00.000Z");
  const result = await getWeeklyReviewReadModel(ACTOR, deps("America/New_York"), { now });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.window.weekStart, "2026-01-05");
  assert.equal(result.data.window.weekEnd, "2026-01-11");
  assert.equal(result.data.window.timezone, "America/New_York");
});

test("New York 00:30 Monday (UTC 05:30) moves to new week", async () => {
  const now = new Date("2026-01-12T05:30:00.000Z"); // NY Mon 00:30 Jan 12
  const result = await getWeeklyReviewReadModel(ACTOR, deps("America/New_York"), { now });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.window.weekStart, "2026-01-12");
  assert.equal(result.data.window.weekEnd, "2026-01-18");
});

// ---------------------------------------------------------------------------
// 3. Monday boundary (exact midnight)
// ---------------------------------------------------------------------------

test("Monday boundary: UTC Monday 00:00 vs Tokyo Monday 00:00 different weeks", async () => {
  // UTC Mon 2026-01-12 00:00 => UTC week Mon 12
  // Tokyo Mon 2026-01-12 00:00 = Sun 2026-01-11 15:00 UTC => should still be Mon 12 for Tokyo,
  // but for UTC it is also Mon 12 (same). Need a case where local Monday is UTC Sunday.
  // Use NY where Monday 00:00 NY = Monday 05:00 UTC (same date). Use Tokyo where Monday 00:00 JST = Sunday 15:00 UTC previous day.
  const utcNow = new Date("2026-01-12T00:00:00.000Z");
  const tokyoNow = new Date("2026-01-11T15:00:00.000Z"); // Tokyo Mon 00:00
  const utcResult = await getWeeklyReviewReadModel(ACTOR, deps("UTC"), { now: utcNow });
  const tokyoResult = await getWeeklyReviewReadModel(ACTOR, deps("Asia/Tokyo"), { now: tokyoNow });
  assert.equal(utcResult.ok && tokyoResult.ok, true);
  if (!utcResult.ok || !tokyoResult.ok) return;
  // Both should be week Mon 12, but UTC derived from Sunday would be wrong if using UTC for Tokyo.
  assert.equal(utcResult.data.window.weekStart, "2026-01-12");
  assert.equal(tokyoResult.data.window.weekStart, "2026-01-12");
  // Ensure Tokyo's UTC start reflects JST offset (9h) not UTC midnight
  assert.equal(tokyoResult.data.window.weekStartUtc, "2026-01-11T15:00:00.000Z");
  assert.equal(utcResult.data.window.weekStartUtc, "2026-01-12T00:00:00.000Z");
});

// ---------------------------------------------------------------------------
// 4. DST week
// ---------------------------------------------------------------------------

test("DST spring forward week (America/New_York March 2026) still Monday-Sunday with 23h Sunday", async () => {
  // DST starts Sun Mar 8 2026 02:00 -> 03:00 (NY). Week Mon Mar 9 - Sun Mar 15 is after DST.
  // Previous week Mon Mar 2 - Sun Mar 8 includes DST transition.
  const now = new Date("2026-03-09T10:00:00.000Z"); // Mon Mar 9 05:00 NY (DST UTC-4)
  const result = await getWeeklyReviewReadModel(ACTOR, deps("America/New_York"), { now });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.window.weekStart, "2026-03-09");
  assert.equal(result.data.window.weekEnd, "2026-03-15");
  // Previous week should be 7 days minus 1h = 167h
  const prev = result.data.comparison.previousWindow;
  assert.equal(prev.weekStart, "2026-03-02");
  assert.equal(prev.weekEnd, "2026-03-08");
  const durationMs = new Date(prev.weekEndExclusiveUtc).getTime() - new Date(prev.weekStartUtc).getTime();
  assert.equal(durationMs, 7 * 24 * 3600 * 1000 - 3600 * 1000);
});

test("DST fall back week (America/New_York Nov 2026) 25h Sunday", async () => {
  const now = new Date("2026-11-02T10:00:00.000Z"); // Mon Nov 2
  const result = await getWeeklyReviewReadModel(ACTOR, deps("America/New_York"), { now });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.window.weekStart, "2026-11-02");
  // Previous week includes fall back Sun Nov 1 02:00 -> 01:00 repeated (25h)
  const prev = result.data.comparison.previousWindow;
  assert.equal(prev.weekStart, "2026-10-26");
  assert.equal(prev.weekEnd, "2026-11-01");
  const durationMs = new Date(prev.weekEndExclusiveUtc).getTime() - new Date(prev.weekStartUtc).getTime();
  assert.equal(durationMs, 7 * 24 * 3600 * 1000 + 3600 * 1000);
});

// ---------------------------------------------------------------------------
// 5. Historical week selection (explicit weekOf) is not now-dependent
// ---------------------------------------------------------------------------

test("historical explicit weekOf ignores now and uses requested timezone", async () => {
  const explicit = "2026-01-05";
  const now1 = new Date("2026-03-15T10:00:00.000Z");
  const now2 = new Date("2026-06-01T01:00:00.000Z");
  const r1 = await getWeeklyReviewReadModel(ACTOR, deps("Asia/Tokyo"), { weekOf: explicit, now: now1 });
  const r2 = await getWeeklyReviewReadModel(ACTOR, deps("Asia/Tokyo"), { weekOf: explicit, now: now2 });
  assert.equal(r1.ok && r2.ok, true);
  if (!r1.ok || !r2.ok) return;
  assert.deepEqual(r1.data.window, r2.data.window);
  assert.equal(r1.data.window.weekStart, "2026-01-05");
  assert.equal(r1.data.window.weekEnd, "2026-01-11");
  assert.equal(r1.data.window.timezone, "Asia/Tokyo");
});

test("historical week with timezone override uses requested timezone not stored", async () => {
  const result = await getWeeklyReviewReadModel(ACTOR, deps("America/New_York"), {
    weekOf: "2026-01-12",
    timezone: "Asia/Tokyo",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.window.timezone, "Asia/Tokyo");
  assert.equal(result.data.window.weekStart, "2026-01-12");
  assert.equal(result.data.window.weekStartUtc, "2026-01-11T15:00:00.000Z");
});

// ---------------------------------------------------------------------------
// 6. No UTC todayIso as authority: ensure no regression to UTC
// ---------------------------------------------------------------------------

test("explicit UTC today fallback still works but Time Context missing uses UTC", async () => {
  const now = new Date("2026-01-15T10:00:00.000Z");
  const result = await getWeeklyReviewReadModel(ACTOR, deps(null), { now });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.window.timezone, "UTC");
  assert.equal(result.data.window.fallback, "missing_timezone");
  // Week should be Mon 2026-01-12 for UTC
  assert.equal(result.data.window.weekStart, "2026-01-12");
});
