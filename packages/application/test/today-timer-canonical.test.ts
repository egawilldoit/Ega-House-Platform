import assert from "node:assert/strict";
import test from "node:test";

import {
  createAuthenticatedActor,
  getTimerWorkspace,
  getTodayPlan,
  type AuthenticatedActor,
  type RepositoryResult,
  type TimeContextRepository,
  type TodayReadPort,
  type TodaySourceTask,
  type TimerSessionRecord,
  type TimerSessionRepository,
  type StartableTask,
} from "../src/index";

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
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
  capturedWindowEnd: string | null = null;
  constructor(private readonly tasks: TodaySourceTask[]) {}
  async listSelectedTasks(actor: AuthenticatedActor, input: { today: string; windowStartIso?: string; windowEndIso?: string }) {
    void actor;
    this.capturedToday = input.today;
    this.capturedWindowStart = input.windowStartIso ?? null;
    this.capturedWindowEnd = input.windowEndIso ?? null;
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

class FakeTimeContextRepo implements TimeContextRepository {
  constructor(private stored: string | null, private shouldFail = false) {}
  async getTimezone(actor: AuthenticatedActor): Promise<RepositoryResult<string | null>> {
    void actor;
    if (this.shouldFail) return { ok: false, error: { code: "unknown" } };
    return ok(this.stored);
  }
  async setTimezone(actor: AuthenticatedActor, timezone: string): Promise<RepositoryResult<string>> {
    void actor;
    this.stored = timezone;
    return ok(timezone);
  }
}

class FakeTimerRepository implements TimerSessionRepository {
  constructor(private readonly sessions: TimerSessionRecord[] = []) {}
  async listOpenSessions(actor: AuthenticatedActor) {
    void actor;
    return ok(this.sessions.filter((s) => s.endedAt === null));
  }
  async listRecentSessions(actor: AuthenticatedActor, _input: { limit: number }) {
    void actor;
    void _input;
    return ok(this.sessions);
  }
  async getStartableTask(actor: AuthenticatedActor, _input: { taskId: string }) {
    void actor;
    void _input;
    return ok({ eligible: true, reason: null, taskTitle: "X" } as StartableTask);
  }
  async insertOpenSession(actor: AuthenticatedActor, _input: { taskId: string; startedAtIso: string }) {
    void actor;
    return ok({ id: "new", taskId: "task-1", startedAt: _input.startedAtIso, endedAt: null, durationSeconds: null, taskTitle: "X" });
  }
  async finalizeOpenSession(actor: AuthenticatedActor, _input: { sessionId: string; endedAtIso: string; durationSeconds: number }) {
    void actor;
    void _input;
    return ok(true);
  }
}

// Required regression coverage: stored Asia/Tokyo, stored America/New_York, no explicit query timezone, midnight, DST spring, DST fall, missing timezone fallback, invalid timezone fallback, server TZ independence.

test("Today with stored Asia/Tokyo no explicit timezone resolves to Tokyo local date", async () => {
  const now = new Date("2026-01-15T15:00:00.000Z"); // 00:00 2026-01-16 in Tokyo
  const port = new FakeTodayPort([task({ id: "t1" })]);
  const repo = new FakeTimeContextRepo("Asia/Tokyo");
  const result = await getTodayPlan(createAuthenticatedActor("u1"), port, repo, { now });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(port.capturedToday, "2026-01-16");
  assert.equal(result.data.date, "2026-01-16");
  assert.equal(port.capturedWindowStart, "2026-01-15T15:00:00.000Z");
  assert.equal(port.capturedWindowEnd, "2026-01-16T15:00:00.000Z");
});

test("Today with stored America/New_York no explicit timezone", async () => {
  const now = new Date("2026-01-15T12:00:00.000Z"); // 07:00 in NY on 2026-01-15
  const port = new FakeTodayPort([task({ id: "t1" })]);
  const repo = new FakeTimeContextRepo("America/New_York");
  const result = await getTodayPlan(createAuthenticatedActor("u1"), port, repo, { now });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(port.capturedToday, "2026-01-15");
  assert.equal(port.capturedWindowStart, "2026-01-15T05:00:00.000Z");
  assert.equal(port.capturedWindowEnd, "2026-01-16T05:00:00.000Z");
});

test("Today no explicit query timezone uses stored not UTC", async () => {
  const now = new Date("2026-01-15T15:00:00.000Z");
  // If stored is Tokyo, date must be 2026-01-16, not UTC 2026-01-15
  const portTokyo = new FakeTodayPort([task({ id: "t1" })]);
  const repoTokyo = new FakeTimeContextRepo("Asia/Tokyo");
  const rTokyo = await getTodayPlan(createAuthenticatedActor("u1"), portTokyo, repoTokyo, { now });
  assert.equal(rTokyo.ok && rTokyo.data.date, "2026-01-16");

  // If stored is UTC via missing, date is UTC
  const portUtc = new FakeTodayPort([task({ id: "t1" })]);
  const repoMissing = new FakeTimeContextRepo(null);
  const rUtc = await getTodayPlan(createAuthenticatedActor("u1"), portUtc, repoMissing, { now });
  assert.equal(rUtc.ok && rUtc.data.date, "2026-01-15");
});

test("Today midnight boundary in stored America/New_York", async () => {
  const repo = new FakeTimeContextRepo("America/New_York");
  const before = new Date("2026-01-15T04:59:59.000Z"); // still 2026-01-14 in NY
  const at = new Date("2026-01-15T05:00:00.000Z"); // 2026-01-15 00:00 NY

  const portBefore = new FakeTodayPort([task({ id: "t1" })]);
  const rBefore = await getTodayPlan(createAuthenticatedActor("u1"), portBefore, repo, { now: before });
  assert.equal(rBefore.ok && rBefore.data.date, "2026-01-14");
  assert.equal(portBefore.capturedWindowStart, "2026-01-14T05:00:00.000Z");

  const portAt = new FakeTodayPort([task({ id: "t1" })]);
  // Need fresh repo with same stored value
  const repo2 = new FakeTimeContextRepo("America/New_York");
  const rAt = await getTodayPlan(createAuthenticatedActor("u1"), portAt, repo2, { now: at });
  assert.equal(rAt.ok && rAt.data.date, "2026-01-15");
  assert.equal(portAt.capturedWindowStart, "2026-01-15T05:00:00.000Z");
});

test("Today DST spring 23h window with stored America/New_York", async () => {
  const now = new Date("2026-03-08T12:00:00.000Z");
  const port = new FakeTodayPort([task({ id: "t1" })]);
  const repo = new FakeTimeContextRepo("America/New_York");
  const result = await getTodayPlan(createAuthenticatedActor("u1"), port, repo, { now });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(port.capturedWindowStart, "2026-03-08T05:00:00.000Z");
  assert.equal(port.capturedWindowEnd, "2026-03-09T04:00:00.000Z");
  const durationHours = (new Date(port.capturedWindowEnd!).getTime() - new Date(port.capturedWindowStart!).getTime()) / 3600000;
  assert.equal(durationHours, 23);
});

test("Today DST fall 25h window with stored America/New_York", async () => {
  const now = new Date("2026-11-01T12:00:00.000Z");
  const port = new FakeTodayPort([task({ id: "t1" })]);
  const repo = new FakeTimeContextRepo("America/New_York");
  const result = await getTodayPlan(createAuthenticatedActor("u1"), port, repo, { now });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(port.capturedWindowStart, "2026-11-01T04:00:00.000Z");
  assert.equal(port.capturedWindowEnd, "2026-11-02T05:00:00.000Z");
  const durationHours = (new Date(port.capturedWindowEnd!).getTime() - new Date(port.capturedWindowStart!).getTime()) / 3600000;
  assert.equal(durationHours, 25);
});

test("Today missing timezone fallback to UTC with missing_timezone", async () => {
  const now = new Date("2026-01-15T12:00:00.000Z");
  const port = new FakeTodayPort([task({ id: "t1" })]);
  const repo = new FakeTimeContextRepo(null);
  const result = await getTodayPlan(createAuthenticatedActor("u1"), port, repo, { now });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(port.capturedWindowStart, "2026-01-15T00:00:00.000Z");
  assert.equal(port.capturedWindowEnd, "2026-01-16T00:00:00.000Z");
});

test("Today invalid timezone fallback to UTC with invalid_timezone", async () => {
  const now = new Date("2026-01-15T12:00:00.000Z");
  const port = new FakeTodayPort([task({ id: "t1" })]);
  const repo = new FakeTimeContextRepo("Invalid/Zone");
  const result = await getTodayPlan(createAuthenticatedActor("u1"), port, repo, { now });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(port.capturedWindowStart, "2026-01-15T00:00:00.000Z");
  assert.equal(port.capturedWindowEnd, "2026-01-16T00:00:00.000Z");
});

test("Today server TZ independence with stored timezone", async () => {
  const originalTz = process.env.TZ;
  const now = new Date("2026-01-15T15:00:00.000Z");
  try {
    process.env.TZ = "Asia/Tokyo";
    const port1 = new FakeTodayPort([task({ id: "t1" })]);
    const repo1 = new FakeTimeContextRepo("America/New_York");
    const r1 = await getTodayPlan(createAuthenticatedActor("u1"), port1, repo1, { now });
    assert.equal(r1.ok && r1.data.date, "2026-01-15");
    assert.equal(port1.capturedWindowStart, "2026-01-15T05:00:00.000Z");

    process.env.TZ = "UTC";
    const port2 = new FakeTodayPort([task({ id: "t1" })]);
    const repo2 = new FakeTimeContextRepo("America/New_York");
    const r2 = await getTodayPlan(createAuthenticatedActor("u1"), port2, repo2, { now });
    assert.equal(r2.ok && r2.data.date, "2026-01-15");
    assert.equal(port2.capturedWindowStart, "2026-01-15T05:00:00.000Z");

    assert.equal(port1.capturedToday, port2.capturedToday);
    assert.equal(port1.capturedWindowStart, port2.capturedWindowStart);

    process.env.TZ = "America/Los_Angeles";
    const port3 = new FakeTodayPort([task({ id: "t1" })]);
    const repo3 = new FakeTimeContextRepo("Asia/Tokyo");
    const r3 = await getTodayPlan(createAuthenticatedActor("u1"), port3, repo3, { now });
    assert.equal(r3.ok && r3.data.date, "2026-01-16");
    assert.equal(port3.capturedWindowStart, "2026-01-15T15:00:00.000Z");
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }
});

test("Timer with stored Asia/Tokyo no explicit timezone uses Tokyo window", async () => {
  const now = new Date("2026-01-15T15:30:00.000Z"); // 00:30 2026-01-16 Tokyo
  const repo = new FakeTimeContextRepo("Asia/Tokyo");
  // Session inside Tokyo today (00:10 on 2026-01-16) => should count
  const sessionsInside: TimerSessionRecord[] = [
    { id: "a", taskId: "t1", startedAt: "2026-01-15T15:10:00.000Z", endedAt: "2026-01-15T15:20:00.000Z", durationSeconds: 600, taskTitle: "Inside" },
  ];
  // Session outside Tokyo today (23:30 on 2026-01-15 Tokyo is 14:30Z on 2026-01-15) => should NOT count for 2026-01-16
  const sessionsOutside: TimerSessionRecord[] = [
    { id: "b", taskId: "t1", startedAt: "2026-01-15T14:30:00.000Z", endedAt: "2026-01-15T14:40:00.000Z", durationSeconds: 600, taskTitle: "Outside" },
  ];
  const timerRepoInside = new FakeTimerRepository(sessionsInside);
  const resultInside = await getTimerWorkspace(createAuthenticatedActor("u1"), timerRepoInside, repo, { now });
  assert.equal(resultInside.ok, true);
  if (!resultInside.ok) return;
  assert.equal(resultInside.data.summary.trackedTodaySeconds, 600);
  assert.equal(resultInside.data.summary.sessionsTodayCount, 1);

  const repo2 = new FakeTimeContextRepo("Asia/Tokyo");
  const timerRepoOutside = new FakeTimerRepository(sessionsOutside);
  const resultOutside = await getTimerWorkspace(createAuthenticatedActor("u1"), timerRepoOutside, repo2, { now });
  assert.equal(resultOutside.ok, true);
  if (!resultOutside.ok) return;
  assert.equal(resultOutside.data.summary.trackedTodaySeconds, 0);
  assert.equal(resultOutside.data.summary.sessionsTodayCount, 0);
});

test("Timer with stored America/New_York no explicit timezone", async () => {
  const now = new Date("2026-01-15T12:00:00.000Z"); // 07:00 NY
  const repo = new FakeTimeContextRepo("America/New_York");
  const sessions: TimerSessionRecord[] = [
    { id: "a", taskId: "t1", startedAt: "2026-01-15T06:00:00.000Z", endedAt: "2026-01-15T07:00:00.000Z", durationSeconds: 3600, taskTitle: "Inside" },
    { id: "b", taskId: "t1", startedAt: "2026-01-15T04:00:00.000Z", endedAt: "2026-01-15T04:30:00.000Z", durationSeconds: 1800, taskTitle: "BeforeMidnight" },
  ];
  const timerRepo = new FakeTimerRepository(sessions);
  const result = await getTimerWorkspace(createAuthenticatedActor("u1"), timerRepo, repo, { now });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // BeforeMidnight session ends at 04:00Z, but NY midnight is 05:00Z, so it is before window start and should not count
  assert.equal(result.data.summary.trackedTodaySeconds, 3600);
  assert.equal(result.data.summary.sessionsTodayCount, 1);
});

test("Timer missing timezone fallback to UTC", async () => {
  const now = new Date("2026-01-15T12:00:00.000Z");
  const repo = new FakeTimeContextRepo(null);
  const sessions: TimerSessionRecord[] = [
    { id: "a", taskId: "t1", startedAt: "2026-01-14T23:30:00.000Z", endedAt: "2026-01-15T00:30:00.000Z", durationSeconds: 3600, taskTitle: "CrossUTCmidnight" },
  ];
  const timerRepo = new FakeTimerRepository(sessions);
  const result = await getTimerWorkspace(createAuthenticatedActor("u1"), timerRepo, repo, { now });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // UTC window [00:00,12:00) => overlap is 00:00-00:30 = 1800s
  assert.equal(result.data.summary.trackedTodaySeconds, 1800);
});

test("Timer invalid timezone fallback to UTC", async () => {
  const now = new Date("2026-01-15T12:00:00.000Z");
  const repo = new FakeTimeContextRepo("Bad/Zone");
  const sessions: TimerSessionRecord[] = [
    { id: "a", taskId: "t1", startedAt: "2026-01-15T01:00:00.000Z", endedAt: "2026-01-15T02:00:00.000Z", durationSeconds: 3600, taskTitle: "X" },
  ];
  const timerRepo = new FakeTimerRepository(sessions);
  const result = await getTimerWorkspace(createAuthenticatedActor("u1"), timerRepo, repo, { now });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.summary.trackedTodaySeconds, 3600);
});

test("Timer DST spring 23h window", async () => {
  const now = new Date("2026-03-08T12:00:00.000Z");
  const repo = new FakeTimeContextRepo("America/New_York");
  const sessions: TimerSessionRecord[] = [
    { id: "a", taskId: "t1", startedAt: "2026-03-08T06:00:00.000Z", endedAt: "2026-03-08T07:00:00.000Z", durationSeconds: 3600, taskTitle: "X" },
  ];
  const timerRepo = new FakeTimerRepository(sessions);
  const result = await getTimerWorkspace(createAuthenticatedActor("u1"), timerRepo, repo, { now });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Verify window is 23h by checking overlap: session at 06Z is inside window [05:00,04:00 next day)
  assert.equal(result.data.summary.trackedTodaySeconds, 3600);
  // Directly check resolver window length
  const { resolveTimeContext } = await import("../src/shared/time-context");
  const ctx = await resolveTimeContext(createAuthenticatedActor("u1"), repo, { now });
  assert.equal(ctx.ok && ctx.data.dayWindow.durationHours, 23);
});

test("Timer DST fall 25h window", async () => {
  const now = new Date("2026-11-01T12:00:00.000Z");
  const repo = new FakeTimeContextRepo("America/New_York");
  const sessions: TimerSessionRecord[] = [
    { id: "a", taskId: "t1", startedAt: "2026-11-01T05:00:00.000Z", endedAt: "2026-11-01T06:00:00.000Z", durationSeconds: 3600, taskTitle: "X" },
  ];
  const timerRepo = new FakeTimerRepository(sessions);
  const result = await getTimerWorkspace(createAuthenticatedActor("u1"), timerRepo, repo, { now });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.summary.trackedTodaySeconds, 3600);
  const { resolveTimeContext } = await import("../src/shared/time-context");
  const ctx = await resolveTimeContext(createAuthenticatedActor("u1"), repo, { now });
  assert.equal(ctx.ok && ctx.data.dayWindow.durationHours, 25);
});

test("Timer midnight boundary with stored America/New_York", async () => {
  const repoBefore = new FakeTimeContextRepo("America/New_York");
  const nowBefore = new Date("2026-01-15T04:59:59.000Z");
  const sessions: TimerSessionRecord[] = [
    { id: "a", taskId: "t1", startedAt: "2026-01-15T04:30:00.000Z", endedAt: "2026-01-15T04:45:00.000Z", durationSeconds: 900, taskTitle: "X" },
  ];
  const timerRepoBefore = new FakeTimerRepository(sessions);
  const resultBefore = await getTimerWorkspace(createAuthenticatedActor("u1"), timerRepoBefore, repoBefore, { now: nowBefore });
  assert.equal(resultBefore.ok, true);
  if (!resultBefore.ok) return;
  // 04:30Z is still 2026-01-14 in NY, and window for 2026-01-14 is [2026-01-14T05:00Z, 2026-01-15T05:00Z)
  // nowBefore is 04:59:59Z inside that window, session 04:30-04:45 should count for 2026-01-14
  assert.equal(resultBefore.data.summary.trackedTodaySeconds, 900);

  const repoAt = new FakeTimeContextRepo("America/New_York");
  const nowAt = new Date("2026-01-15T05:00:00.000Z");
  const timerRepoAt = new FakeTimerRepository(sessions);
  const resultAt = await getTimerWorkspace(createAuthenticatedActor("u1"), timerRepoAt, repoAt, { now: nowAt });
  assert.equal(resultAt.ok, true);
  if (!resultAt.ok) return;
  // Now window is 2026-01-15 [05:00, ...), session at 04:30Z is before window, should NOT count
  assert.equal(resultAt.data.summary.trackedTodaySeconds, 0);
});

test("Timer server TZ independence with stored timezone", async () => {
  const originalTz = process.env.TZ;
  const now = new Date("2026-01-15T12:00:00.000Z");
  const sessions: TimerSessionRecord[] = [
    { id: "a", taskId: "t1", startedAt: "2026-01-15T06:00:00.000Z", endedAt: "2026-01-15T07:00:00.000Z", durationSeconds: 3600, taskTitle: "X" },
  ];
  try {
    process.env.TZ = "Asia/Tokyo";
    const repo1 = new FakeTimeContextRepo("America/New_York");
    const timerRepo1 = new FakeTimerRepository(sessions);
    const r1 = await getTimerWorkspace(createAuthenticatedActor("u1"), timerRepo1, repo1, { now });

    process.env.TZ = "UTC";
    const repo2 = new FakeTimeContextRepo("America/New_York");
    const timerRepo2 = new FakeTimerRepository(sessions);
    const r2 = await getTimerWorkspace(createAuthenticatedActor("u1"), timerRepo2, repo2, { now });

    assert.deepEqual(r1.ok && r1.data.summary, r2.ok && r2.data.summary);
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }
});

test("Timer and Today explicit validated override still works over stored", async () => {
  const nowToday = new Date("2026-01-15T15:00:00.000Z");
  // Stored is NY, but requested is Tokyo -> should use Tokyo
  const port = new FakeTodayPort([task({ id: "t1" })]);
  const repo = new FakeTimeContextRepo("America/New_York");
  const r = await getTodayPlan(createAuthenticatedActor("u1"), port, repo, { now: nowToday, timezone: "Asia/Tokyo" });
  assert.equal(r.ok && r.data.date, "2026-01-16");
  assert.equal(port.capturedWindowStart, "2026-01-15T15:00:00.000Z");

  const nowTimer = new Date("2026-01-15T16:00:00.000Z");
  const timerRepo = new FakeTimerRepository([{ id: "a", taskId: "t1", startedAt: "2026-01-15T15:10:00.000Z", endedAt: "2026-01-15T15:20:00.000Z", durationSeconds: 600, taskTitle: "X" }]);
  const repo2 = new FakeTimeContextRepo("America/New_York");
  const timerResult = await getTimerWorkspace(createAuthenticatedActor("u1"), timerRepo, repo2, { now: nowTimer, timezone: "Asia/Tokyo" });
  assert.equal(timerResult.ok && timerResult.data.summary.trackedTodaySeconds, 600);
});
