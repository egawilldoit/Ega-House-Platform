import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor, getTodayPlan, type AuthenticatedActor, type TodayReadPort, type RepositoryResult, type TimeContextRepository, type TodaySourceTask } from "../src/index";

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

class FakeTimeContextRepo implements TimeContextRepository {
  constructor(private stored: string | null = null) {}
  async getTimezone(): Promise<RepositoryResult<string | null>> {
    return ok(this.stored);
  }
  async setTimezone(_actor: AuthenticatedActor, timezone: string): Promise<RepositoryResult<string>> {
    this.stored = timezone;
    return ok(timezone);
  }
}

function task(overrides: Partial<TodaySourceTask> & { id: string }): TodaySourceTask {
  return {
    title: `Task ${overrides.id}`,
    description: null,
    blockedReason: null,
    status: "todo",
    priority: "medium",
    dueDate: null,
    estimateMinutes: null,
    scheduledStartAt: null,
    scheduledEndAt: null,
    focusRank: null,
    plannedForDate: "2026-01-15",
    updatedAt: "2026-01-15T08:00:00.000Z",
    completedAt: null,
    projectName: "Apollo",
    projectSlug: "apollo",
    goalTitle: null,
    ...overrides,
  };
}

class FakeTodayPort implements TodayReadPort {
  capturedToday: string | null = null;
  capturedWindowStart: string | null = null;
  constructor(private readonly tasks: TodaySourceTask[]) {}
  async listSelectedTasks(actor: AuthenticatedActor, input: { today: string }) {
    void actor;
    this.capturedToday = input.today;
    return ok(this.tasks);
  }
  async listPinnedSuggestions(actor: AuthenticatedActor) {
    void actor;
    return ok([]);
  }
  async listInProgressSuggestions(actor: AuthenticatedActor) {
    void actor;
    return ok([]);
  }
  async getTodayTimerSnapshot(actor: AuthenticatedActor, input: { nowIso: string; windowStartIso: string }) {
    void actor;
    this.capturedWindowStart = input.windowStartIso;
    return ok({ activeTimer: null, trackedTodaySeconds: 0 });
  }
}

// C1: Today must be server-TZ independent and use canonical dayWindow.
// Instant 2026-01-15T15:00:00Z is 2026-01-15 in UTC but 2026-01-16 00:00 in Asia/Tokyo.
// When canonical timezone is Asia/Tokyo, Today date must be 2026-01-16 regardless of server TZ.
// When no timezone is given, canonical fallback is UTC (2026-01-15) regardless of server TZ.
// This test will fail before C1 fix because getTodayPlan currently uses toLocalIsoDate (process TZ).
test("getTodayPlan server TZ Asia/Tokyo vs UTC yields same canonical Today (C1)", async () => {
  const originalTz = process.env.TZ;
  const now = new Date("2026-01-15T15:00:00.000Z");
  try {
    process.env.TZ = "Asia/Tokyo";
    const portTokyo = new FakeTodayPort([task({ id: "t1" })]);
    const timeRepo = new FakeTimeContextRepo(null);
    const resultTokyo = await getTodayPlan(createAuthenticatedActor("user-tz"), portTokyo, timeRepo, {
      now,
      timezone: "Asia/Tokyo",
    } as any);
    assert.equal(resultTokyo.ok, true);
    if (!resultTokyo.ok) return;
    assert.equal(portTokyo.capturedToday, "2026-01-16");
    assert.equal(resultTokyo.data.date, "2026-01-16");
    // windowStartIso must be canonical Asia/Tokyo midnight => 2026-01-15T15:00:00Z
    assert.equal(portTokyo.capturedWindowStart, "2026-01-15T15:00:00.000Z");

    process.env.TZ = "UTC";
    const portUTC = new FakeTodayPort([task({ id: "t1" })]);
    const timeRepo2 = new FakeTimeContextRepo(null);
    const resultUTC = await getTodayPlan(createAuthenticatedActor("user-tz"), portUTC, timeRepo2, {
      now,
      timezone: "Asia/Tokyo",
    } as any);
    assert.equal(resultUTC.ok, true);
    if (!resultUTC.ok) return;
    assert.equal(portUTC.capturedToday, "2026-01-16");
    assert.equal(resultUTC.data.date, "2026-01-16");
    assert.equal(portUTC.capturedWindowStart, "2026-01-15T15:00:00.000Z");
    // Both server TZs must yield identical Today semantics for same canonical timezone
    assert.equal(portTokyo.capturedToday, portUTC.capturedToday);
    assert.equal(portTokyo.capturedWindowStart, portUTC.capturedWindowStart);
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }
});

test("getTodayPlan defaults to UTC and is server TZ independent when no timezone given (C1)", async () => {
  const originalTz = process.env.TZ;
  const now = new Date("2026-01-15T15:00:00.000Z");
  try {
    process.env.TZ = "Asia/Tokyo";
    const port1 = new FakeTodayPort([task({ id: "t1" })]);
    const repo1 = new FakeTimeContextRepo(null);
    const r1 = await getTodayPlan(createAuthenticatedActor("u1"), port1, repo1, { now } as any);
    assert.equal(r1.ok && r1.data.date, "2026-01-15");
    assert.equal(port1.capturedWindowStart, "2026-01-15T00:00:00.000Z");

    process.env.TZ = "UTC";
    const port2 = new FakeTodayPort([task({ id: "t1" })]);
    const repo2 = new FakeTimeContextRepo(null);
    const r2 = await getTodayPlan(createAuthenticatedActor("u1"), port2, repo2, { now } as any);
    assert.equal(r2.ok && r2.data.date, "2026-01-15");
    assert.equal(port2.capturedWindowStart, "2026-01-15T00:00:00.000Z");
    assert.equal(port1.capturedToday, port2.capturedToday);
    assert.equal(port1.capturedWindowStart, port2.capturedWindowStart);
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }
});

test("timer summarize uses canonical dayWindow, server TZ independent (C1)", async () => {
  const { summarizeTimerSessions } = await import("../src/timer/service");
  const originalTz = process.env.TZ;
  try {
    process.env.TZ = "Asia/Tokyo";
    const s1 = summarizeTimerSessions(
      [
        { id: "a", taskId: "t1", startedAt: "2026-01-15T14:30:00.000Z", endedAt: "2026-01-15T15:30:00.000Z", durationSeconds: 3600, taskTitle: "X" },
      ],
      "2026-01-15T16:00:00.000Z",
      { startIso: "2026-01-15T00:00:00.000Z", endIso: "2026-01-15T15:00:00.000Z" } as any,
    );
    process.env.TZ = "UTC";
    const s2 = summarizeTimerSessions(
      [
        { id: "a", taskId: "t1", startedAt: "2026-01-15T14:30:00.000Z", endedAt: "2026-01-15T15:30:00.000Z", durationSeconds: 3600, taskTitle: "X" },
      ],
      "2026-01-15T16:00:00.000Z",
      { startIso: "2026-01-15T00:00:00.000Z", endIso: "2026-01-15T15:00:00.000Z" } as any,
    );
    assert.deepEqual(s1, s2);
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }
});
