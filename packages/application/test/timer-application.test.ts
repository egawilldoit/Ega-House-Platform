import assert from "node:assert/strict";
import test from "node:test";

import {
  createAuthenticatedActor,
  getTimerWorkspace,
  startTaskSession,
  stopTaskSession,
  summarizeTimerSessions,
  type AuthenticatedActor,
  type RepositoryResult,
  type StartableTask,
  type TimerSessionRecord,
  type TimerSessionRepository,
} from "../src/index";

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

class FakeTimerRepository implements TimerSessionRepository {
  sessions: TimerSessionRecord[] = [];
  finalized: Array<{ sessionId: string; endedAtIso: string; durationSeconds: number }> = [];
  nextId = 1;
  startableOverride: StartableTask | null = null;

  seed(session: Partial<TimerSessionRecord> & { id: string }) {
    this.sessions.push({
      taskId: "task-1",
      startedAt: "2026-08-10T08:00:00.000Z",
      endedAt: null,
      durationSeconds: null,
      taskTitle: "Seeded task",
      ...session,
    });
  }

  async listOpenSessions(actor: AuthenticatedActor) {
    return ok(this.sessions.filter((session) => session.endedAt === null));
  }

  async listRecentSessions(actor: AuthenticatedActor, input: { limit: number }) {
    return ok(this.sessions.slice(0, input.limit));
  }

  async getStartableTask(actor: AuthenticatedActor, input: { taskId: string }) {
    if (this.startableOverride) return ok(this.startableOverride);
    if (input.taskId !== "task-1") return ok(null);
    return ok({ eligible: true, reason: null, taskTitle: "Seeded task" });
  }

  async insertOpenSession(
    actor: AuthenticatedActor,
    input: { taskId: string; startedAtIso: string },
  ) {
    const session: TimerSessionRecord = {
      id: `session-${this.nextId++}`,
      taskId: input.taskId,
      startedAt: input.startedAtIso,
      endedAt: null,
      durationSeconds: null,
      taskTitle: "Seeded task",
    };
    this.sessions.push(session);
    return ok(session);
  }

  async finalizeOpenSession(
    actor: AuthenticatedActor,
    input: { sessionId: string; endedAtIso: string; durationSeconds: number },
  ) {
    const session = this.sessions.find(
      (candidate) => candidate.id === input.sessionId && candidate.endedAt === null,
    );
    if (!session) return ok(false);
    this.sessions = this.sessions.map((candidate) =>
      candidate.id === input.sessionId && candidate.endedAt === null
        ? { ...candidate, endedAt: input.endedAtIso, durationSeconds: input.durationSeconds }
        : candidate,
    );
    this.finalized.push(input);
    return ok(true);
  }
}

const NOW = new Date("2026-08-10T12:00:00Z");

test("start rejects a second open session (single-active invariant)", async () => {
  const repository = new FakeTimerRepository();
  const actor = createAuthenticatedActor("user-timer");

  const first = await startTaskSession(actor, repository, { taskId: "task-1" }, { now: NOW });
  assert.equal(first.ok, true);

  const second = await startTaskSession(actor, repository, { taskId: "task-1" }, { now: NOW });
  assert.equal(second.ok, false);
  if (!second.ok) assert.match(second.errorMessage, /already running/);
  assert.equal(repository.sessions.length, 1);
});

test("start rejects ineligible tasks and unknown tasks", async () => {
  const actor = createAuthenticatedActor("user-timer");

  const archived = new FakeTimerRepository();
  archived.startableOverride = { eligible: false, reason: "This task is archived.", taskTitle: "Archived" };
  const archivedResult = await startTaskSession(actor, archived, { taskId: "task-1" }, { now: NOW });
  assert.equal(archivedResult.ok, false);
  if (!archivedResult.ok) assert.match(archivedResult.errorMessage, /archived/);
  assert.equal(archived.sessions.length, 0);

  const missing = new FakeTimerRepository();
  const missingResult = await startTaskSession(actor, missing, { taskId: "nope" }, { now: NOW });
  assert.equal(missingResult.ok, false);
  if (!missingResult.ok) assert.match(missingResult.errorMessage, /unavailable/);

  const blank = await startTaskSession(actor, missing, { taskId: "  " }, { now: NOW });
  assert.equal(blank.ok, false);
});

test("stop finalizes only the target open session with computed duration", async () => {
  const repository = new FakeTimerRepository();
  const actor = createAuthenticatedActor("user-timer");
  repository.seed({ id: "older", startedAt: "2026-08-10T07:00:00.000Z" });
  repository.seed({ id: "newer", startedAt: "2026-08-10T09:00:00.000Z" });

  const stopped = await stopTaskSession(actor, repository, {}, { now: NOW });
  assert.equal(stopped.ok, true);
  if (stopped.ok) assert.deepEqual(stopped.data, { sessionId: "newer", taskId: "task-1" });
  assert.equal(repository.finalized[0].durationSeconds, 3 * 3600);

  const explicit = await stopTaskSession(actor, repository, { sessionId: "older" }, { now: NOW });
  assert.equal(explicit.ok, true);
  if (explicit.ok) assert.equal(explicit.data.sessionId, "older");

  const gone = await stopTaskSession(actor, repository, { sessionId: "newer" }, { now: NOW });
  assert.equal(gone.ok, false);
});

test("workspace exposes the newest open session and summary aggregates", async () => {
  const repository = new FakeTimerRepository();
  const actor = createAuthenticatedActor("user-timer");
  repository.seed({
    id: "active",
    startedAt: "2026-08-10T11:00:00.000Z",
    taskTitle: "Focus work",
  });
  repository.seed({
    id: "earlier",
    startedAt: "2026-08-10T06:00:00.000Z",
    endedAt: "2026-08-10T07:00:00.000Z",
    durationSeconds: 3600,
    taskTitle: "Morning run",
  });

  const result = await getTimerWorkspace(actor, repository, { now: NOW });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.data.activeSession, {
    sessionId: "active",
    taskId: "task-1",
    startedAt: "2026-08-10T11:00:00.000Z",
    elapsedLabel: "1h 0m 0s",
    taskTitle: "Focus work",
  });

  assert.equal(result.data.summary.trackedTodaySeconds, 2 * 3600);
  assert.equal(result.data.summary.trackedTodayLabel, "2h 0m 0s");
  assert.equal(result.data.summary.trackedTotalSeconds, 2 * 3600);
  assert.equal(result.data.summary.sessionsTodayCount, 2);
  assert.equal(result.data.summary.longestSessionSeconds, 3600);
  assert.equal(result.data.summary.longestSessionTaskTitle, "Focus work");
});

test("summarizeTimerSessions clamps open sessions to now for today overlap", () => {
  const summary = summarizeTimerEntries();
  assert.equal(summary.sessionsTodayCount, 2);
  assert.equal(summary.longestSessionSeconds, 9000);
});

function summarizeTimerEntries() {
  return summarizeTimerSessions(
    [
      {
        id: "a",
        taskId: "t1",
        startedAt: "2026-08-10T23:30:00.000Z",
        endedAt: null,
        durationSeconds: null,
        taskTitle: null,
      },
      {
        id: "b",
        taskId: "t2",
        startedAt: "2026-08-09T22:00:00.000Z",
        endedAt: "2026-08-10T00:30:00.000Z",
        durationSeconds: 9000,
        taskTitle: "Crosses midnight",
      },
    ],
    "2026-08-10T23:40:00.000Z",
  );
}
