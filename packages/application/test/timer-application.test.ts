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
  type TimeContextRepository,
  type TimerSessionRecord,
  type TimerSessionRepository,
} from "../src/index";

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

class FakeTimerRepository implements TimerSessionRepository {
  sessions: TimerSessionRecord[] = [];
  finalized: Array<{ sessionId: string; endedAtIso: string; durationSeconds: number }> = [];
  nextId = 1;
  startableOverride: StartableTask | null = null;
  insertFailure: { code: "conflict" | "unknown" } | null = null;
  operationSessions = new Map<string, TimerSessionRecord>();
  private owners = new Map<string, string>();
  /** Simulates two devices whose pre-check reads raced ahead of the INSERT. */
  suppressOpenVisibility = false;
  /** Simulates a concurrent device winning the finalize between read and UPDATE. */
  loseFinalizeRace = false;

  seed(session: Partial<TimerSessionRecord> & { id: string }, ownerId = "user-timer") {
    this.sessions.push({
      taskId: "task-1",
      startedAt: "2026-08-10T08:00:00.000Z",
      endedAt: null,
      durationSeconds: null,
      taskTitle: "Seeded task",
      ...session,
    });
    this.owners.set(session.id, ownerId);
  }

  private owns(actor: AuthenticatedActor, sessionId: string) {
    return this.owners.get(sessionId) === actor.userId;
  }

  async listOpenSessions(actor: AuthenticatedActor) {
    if (this.suppressOpenVisibility) return ok([]);
    return ok(
      this.sessions.filter(
        (session) => session.endedAt === null && this.owns(actor, session.id),
      ),
    );
  }

  async listSummarySessions(actor: AuthenticatedActor) {
    return ok(this.sessions.filter(session => this.owns(actor, session.id)));
  }

  async getStartableTask(actor: AuthenticatedActor, input: { taskId: string }) {
    void actor;
    if (this.startableOverride) return ok(this.startableOverride);
    if (input.taskId !== "task-1") return ok(null);
    return ok({ eligible: true, reason: null, taskTitle: "Seeded task" });
  }

  async findSessionByOperation(
    actor: AuthenticatedActor,
    input: { mcpOperationId: string; mcpClientId: string },
  ) {
    void actor;
    return ok(this.operationSessions.get(`${input.mcpClientId}:${input.mcpOperationId}`) ?? null);
  }

  async findSessionById(actor: AuthenticatedActor, input: { sessionId: string }) {
    const session = this.sessions.find(
      (candidate) => candidate.id === input.sessionId && this.owns(actor, candidate.id),
    );
    return ok(session ?? null);
  }

  async insertOpenSession(
    actor: AuthenticatedActor,
    input: {
      taskId: string;
      startedAtIso: string;
      mcpOperationId?: string;
      mcpClientId?: string;
    },
  ) {
    if (this.insertFailure) return { ok: false as const, error: this.insertFailure };
    const operationKey = input.mcpOperationId && input.mcpClientId
      ? `${input.mcpClientId}:${input.mcpOperationId}`
      : null;
    if (operationKey) {
      const existing = this.operationSessions.get(operationKey);
      if (existing) return ok(existing);
    }
    // Enforce the partial unique index task_sessions_owner_open_unique.
    if (
      this.sessions.some(
        (session) => session.endedAt === null && this.owns(actor, session.id),
      )
    ) {
      return { ok: false as const, error: { code: "conflict" as const } };
    }
    const session: TimerSessionRecord = {
      id: `session-${this.nextId++}`,
      taskId: input.taskId,
      startedAt: input.startedAtIso,
      endedAt: null,
      durationSeconds: null,
      taskTitle: "Seeded task",
    };
    this.sessions.push(session);
    this.owners.set(session.id, actor.userId);
    if (operationKey) this.operationSessions.set(operationKey, session);
    return ok(session);
  }

  async finalizeOpenSession(
    actor: AuthenticatedActor,
    input: { sessionId: string; endedAtIso: string; durationSeconds: number },
  ) {
    const session = this.sessions.find(
      (candidate) =>
        candidate.id === input.sessionId &&
        candidate.endedAt === null &&
        this.owns(actor, candidate.id),
    );
    if (!session) return ok(false);
    if (this.loseFinalizeRace) {
      // A concurrent device commits the same stop before our fenced UPDATE
      // lands. Our update affects zero rows; the winner's timing stands.
      this.sessions = this.sessions.map((candidate) =>
        candidate.id === input.sessionId && candidate.endedAt === null
          ? {
              ...candidate,
              endedAt: "2026-08-10T12:00:00.000Z",
              durationSeconds: 1,
            }
          : candidate,
      );
      return ok(false);
    }
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

test("start maps a repository insert conflict to the already-running domain message", async () => {
  const repository = new FakeTimerRepository();
  repository.insertFailure = { code: "conflict" };
  const actor = createAuthenticatedActor("user-timer");

  // Simulates the DB-level race loss: pre-check saw no open session, but the
  // partial unique index rejected the insert with SQLSTATE 23505.
  const result = await startTaskSession(actor, repository, { taskId: "task-1" }, { now: NOW });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorMessage, "A timer is already running. Stop it before starting a new one.");
  }
});

test("fenced timer start retries return the original session without a second effect", async () => {
  const repository = new FakeTimerRepository();
  const actor = createAuthenticatedActor("user-timer");
  const identity = {
    mcpOperationId: "550e8400-e29b-41d4-a716-446655440000",
    mcpClientId: "mcp-client-a",
  };

  const first = await startTaskSession(actor, repository, { taskId: "task-1", ...identity }, { now: NOW });
  repository.startableOverride = {
    eligible: false,
    reason: "This task is archived.",
    taskTitle: "Archived",
  };
  const retry = await startTaskSession(actor, repository, { taskId: "task-1", ...identity }, { now: NOW });

  assert.equal(first.ok, true);
  assert.equal(retry.ok, true);
  if (first.ok && retry.ok) assert.equal(retry.data.sessionId, first.data.sessionId);
  assert.equal(repository.sessions.length, 1);
});

test("start keeps the generic failure message for non-conflict insert failures", async () => {
  const repository = new FakeTimerRepository();
  repository.insertFailure = { code: "unknown" };
  const actor = createAuthenticatedActor("user-timer");

  const result = await startTaskSession(actor, repository, { taskId: "task-1" }, { now: NOW });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorMessage, "Unable to start the timer right now.");
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

test("stop requires an explicit session id and never falls back to the newest open session", async () => {
  const repository = new FakeTimerRepository();
  const actor = createAuthenticatedActor("user-timer");
  repository.seed({ id: "older", startedAt: "2026-08-10T07:00:00.000Z" });
  repository.seed({ id: "newer", startedAt: "2026-08-10T09:00:00.000Z" });

  const missing = await stopTaskSession(actor, repository, {}, { now: NOW });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.errorMessage, /session id/i);

  const blank = await stopTaskSession(actor, repository, { sessionId: "   " }, { now: NOW });
  assert.equal(blank.ok, false);
  assert.equal(repository.finalized.length, 0);
  assert.equal(repository.sessions.find((session) => session.id === "newer")?.endedAt, null);
});

test("stop finalizes only the exact target session with computed duration", async () => {
  const repository = new FakeTimerRepository();
  const actor = createAuthenticatedActor("user-timer");
  repository.seed({ id: "older", startedAt: "2026-08-10T07:00:00.000Z" });
  repository.seed({ id: "newer", startedAt: "2026-08-10T09:00:00.000Z" });

  const explicit = await stopTaskSession(actor, repository, { sessionId: "older" }, { now: NOW });
  assert.equal(explicit.ok, true);
  if (explicit.ok) {
    assert.deepEqual(explicit.data, {
      status: "stopped",
      sessionId: "older",
      taskId: "task-1",
    });
  }
  assert.equal(repository.finalized[0].durationSeconds, 5 * 3600);
  assert.equal(repository.sessions.find((session) => session.id === "newer")?.endedAt, null);
});

test("duplicate stop acknowledges already_stopped without a second write or duration change", async () => {
  const repository = new FakeTimerRepository();
  const actor = createAuthenticatedActor("user-timer");
  repository.seed({ id: "session-open" });

  const first = await stopTaskSession(
    actor,
    repository,
    { sessionId: "session-open" },
    { now: NOW },
  );
  const second = await stopTaskSession(
    actor,
    repository,
    { sessionId: "session-open" },
    { now: new Date("2026-08-10T13:00:00Z") },
  );

  assert.equal(first.ok, true);
  if (first.ok) assert.equal(first.data.status, "stopped");
  assert.equal(second.ok, true);
  if (second.ok) {
    assert.deepEqual(second.data, {
      status: "already_stopped",
      sessionId: "session-open",
      taskId: "task-1",
    });
  }
  assert.equal(repository.finalized.length, 1);
  const stopped = repository.sessions.find((session) => session.id === "session-open");
  assert.equal(stopped?.endedAt, NOW.toISOString());
  assert.equal(stopped?.durationSeconds, 4 * 3600);
});

test("concurrent finalize that wins the race is acknowledged as already_stopped", async () => {
  const repository = new FakeTimerRepository();
  const actor = createAuthenticatedActor("user-timer");
  repository.seed({ id: "session-open", startedAt: "2026-08-10T11:00:00.000Z" });
  repository.loseFinalizeRace = true;

  const result = await stopTaskSession(
    actor,
    repository,
    { sessionId: "session-open" },
    { now: NOW },
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data, {
      status: "already_stopped",
      sessionId: "session-open",
      taskId: "task-1",
    });
  }
  // Our fenced write lost; only the concurrent device's timing remains.
  assert.equal(repository.finalized.length, 0);
  const stopped = repository.sessions.find((session) => session.id === "session-open");
  assert.equal(stopped?.endedAt, "2026-08-10T12:00:00.000Z");
  assert.equal(stopped?.durationSeconds, 1);
});

test("a delayed stop of a prior session cannot end a newer open session", async () => {
  const repository = new FakeTimerRepository();
  const actor = createAuthenticatedActor("user-timer");
  repository.seed({ id: "prior", startedAt: "2026-08-10T08:00:00.000Z" });
  repository.seed({ id: "newer", startedAt: "2026-08-10T11:00:00.000Z" });

  const stale = await stopTaskSession(
    actor,
    repository,
    { sessionId: "prior" },
    { now: NOW },
  );
  const retried = await stopTaskSession(
    actor,
    repository,
    { sessionId: "prior" },
    { now: new Date("2026-08-10T12:30:00Z") },
  );

  assert.equal(stale.ok, true);
  if (stale.ok) assert.equal(stale.data.status, "stopped");
  assert.equal(retried.ok, true);
  if (retried.ok) assert.equal(retried.data.status, "already_stopped");
  assert.equal(repository.finalized.length, 1);
  assert.equal(repository.sessions.find((session) => session.id === "newer")?.endedAt, null);
});

test("owner mismatch surfaces not-found and performs no write", async () => {
  const repository = new FakeTimerRepository();
  const owner = createAuthenticatedActor("user-timer");
  const otherOwner = createAuthenticatedActor("user-other");
  repository.seed({ id: "owned-session" }, owner.userId);

  const result = await stopTaskSession(
    otherOwner,
    repository,
    { sessionId: "owned-session" },
    { now: NOW },
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorMessage, "No running timer session matches this request.");
  }
  assert.equal(repository.finalized.length, 0);
  assert.equal(
    repository.sessions.find((session) => session.id === "owned-session")?.endedAt,
    null,
  );
});

test("concurrent double start lets exactly one owner open session win", async () => {
  const repository = new FakeTimerRepository();
  const actor = createAuthenticatedActor("user-timer");
  repository.suppressOpenVisibility = true;

  const [first, second] = await Promise.all([
    startTaskSession(actor, repository, { taskId: "task-1" }, { now: NOW }),
    startTaskSession(actor, repository, { taskId: "task-1" }, { now: NOW }),
  ]);

  const successes = [first, second].filter((result) => result.ok);
  const failures = [first, second].filter((result) => !result.ok);
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  if (!failures[0].ok) assert.match(failures[0].errorMessage, /already running/);
  assert.equal(
    repository.sessions.filter((session) => session.endedAt === null).length,
    1,
  );
});

test("cross-midnight stop duration is wall-clock across local midnight and is not extended", async () => {
  const repository = new FakeTimerRepository();
  const actor = createAuthenticatedActor("user-timer");
  repository.seed({
    id: "midnight",
    startedAt: "2026-08-10T23:30:00.000Z",
  });

  const stopped = await stopTaskSession(
    actor,
    repository,
    { sessionId: "midnight" },
    { now: new Date("2026-08-11T00:30:00.000Z") },
  );
  const retry = await stopTaskSession(
    actor,
    repository,
    { sessionId: "midnight" },
    { now: new Date("2026-08-11T02:00:00.000Z") },
  );

  assert.equal(stopped.ok, true);
  assert.equal(repository.finalized[0].durationSeconds, 3600);
  assert.equal(retry.ok, true);
  if (retry.ok) assert.equal(retry.data.status, "already_stopped");
  assert.equal(repository.finalized.length, 1);
  assert.equal(
    repository.sessions.find((session) => session.id === "midnight")?.durationSeconds,
    3600,
  );
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

  const result = await getTimerWorkspace(actor, repository, new FakeTimeContextRepo(null), { now: NOW });
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

test("workspace rejects an invalid current time without throwing", async () => {
  const repository = new FakeTimerRepository();
  const actor = createAuthenticatedActor("user-timer");

  const result = await getTimerWorkspace(
    actor,
    repository,
    new FakeTimeContextRepo(null),
    { now: new Date(Number.NaN) },
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorMessage, "Current time is invalid.");
});

test("workspace totals include sessions beyond the recent 150, including midnight overlap", async () => {
  const repository = new FakeTimerRepository();
  for (let index = 0; index < 150; index += 1) {
    repository.seed({ id: `recent-${index}`, startedAt: "2026-08-10T10:00:00Z",
      endedAt: "2026-08-10T10:00:01Z", durationSeconds: 1 });
  }
  repository.seed({ id: "older", startedAt: "2026-08-09T23:00:00Z",
    endedAt: "2026-08-10T01:00:00Z", durationSeconds: 7200 });
  const result = await getTimerWorkspace(createAuthenticatedActor("user-timer"), repository,
    new FakeTimeContextRepo("UTC"), { now: NOW });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.summary.trackedTotalSeconds, 7350);
  assert.equal(result.data.summary.trackedTodaySeconds, 3750);
  assert.equal(result.data.summary.sessionsTodayCount, 151);
  assert.equal(result.data.summary.longestSessionSeconds, 7200);
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
