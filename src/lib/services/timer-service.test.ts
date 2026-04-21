import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateTimerAggregates,
  getActiveTimerSession,
  stopTimerSession,
  validateTimerSessionTimestampUpdateInput,
} from "./timer-service";

test("validates and normalizes timer session timestamp updates", () => {
  const result = validateTimerSessionTimestampUpdateInput({
    sessionId: "session-1",
    startedAt: "2026-04-21T09:00:00Z",
    endedAt: "2026-04-21T10:30:00Z",
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.sessionId, "session-1");
  assert.equal(result.data?.startedAtIso, "2026-04-21T09:00:00.000Z");
  assert.equal(result.data?.endedAtIso, "2026-04-21T10:30:00.000Z");
  assert.equal(result.data?.durationSeconds, 5400);
});

test("rejects timestamps without explicit timezone", () => {
  const result = validateTimerSessionTimestampUpdateInput({
    sessionId: "session-1",
    startedAt: "2026-04-21T09:00:00",
    endedAt: "2026-04-21T10:30:00Z",
  });

  assert.equal(
    result.errorMessage,
    "Start timestamp must be a valid ISO value with timezone, for example 2026-04-21T10:15:00Z.",
  );
});

test("rejects ended_at values before started_at", () => {
  const result = validateTimerSessionTimestampUpdateInput({
    sessionId: "session-1",
    startedAt: "2026-04-21T11:00:00Z",
    endedAt: "2026-04-21T10:59:59Z",
  });

  assert.equal(result.errorMessage, "End timestamp must be after the start timestamp.");
});

test("requires a session id", () => {
  const result = validateTimerSessionTimestampUpdateInput({
    sessionId: "   ",
    startedAt: "2026-04-21T11:00:00Z",
    endedAt: "2026-04-21T12:00:00Z",
  });

  assert.equal(result.errorMessage, "Session update request is invalid.");
});

test("corrected session on today updates today total and tracked total", () => {
  const baseline = calculateTimerAggregates(
    [
      {
        task_id: "task-1",
        started_at: "2026-04-21T09:00:00.000Z",
        ended_at: "2026-04-21T09:20:00.000Z",
        duration_seconds: 1200,
        tasks: { title: "Fix timer" },
      },
    ],
    {
      nowIso: "2026-04-21T12:00:00.000Z",
      todayWindow: {
        startIso: "2026-04-21T00:00:00.000Z",
        endIso: "2026-04-21T12:00:00.000Z",
      },
    },
  );

  const corrected = calculateTimerAggregates(
    [
      {
        task_id: "task-1",
        started_at: "2026-04-21T09:00:00.000Z",
        ended_at: "2026-04-21T10:28:00.000Z",
        duration_seconds: 1200,
        tasks: { title: "Fix timer" },
      },
    ],
    {
      nowIso: "2026-04-21T12:00:00.000Z",
      todayWindow: {
        startIso: "2026-04-21T00:00:00.000Z",
        endIso: "2026-04-21T12:00:00.000Z",
      },
    },
  );

  assert.equal(baseline.todayTotalDurationSeconds, 1200);
  assert.equal(corrected.todayTotalDurationSeconds, 5280);
  assert.equal(corrected.trackedTotalSeconds, 5280);
});

test("corrected session outside today does not change today total", () => {
  const aggregates = calculateTimerAggregates(
    [
      {
        task_id: "task-1",
        started_at: "2026-04-20T09:00:00.000Z",
        ended_at: "2026-04-20T10:28:00.000Z",
        duration_seconds: 1200,
        tasks: { title: "Fix timer" },
      },
    ],
    {
      nowIso: "2026-04-21T12:00:00.000Z",
      todayWindow: {
        startIso: "2026-04-21T00:00:00.000Z",
        endIso: "2026-04-21T12:00:00.000Z",
      },
    },
  );

  assert.equal(aggregates.todayTotalDurationSeconds, 0);
  assert.equal(aggregates.trackedTotalSeconds, 5280);
});

test("longest session updates when correction makes a session longest", () => {
  const aggregates = calculateTimerAggregates(
    [
      {
        task_id: "task-short",
        started_at: "2026-04-21T07:00:00.000Z",
        ended_at: "2026-04-21T07:30:00.000Z",
        duration_seconds: 1800,
        tasks: { title: "Short" },
      },
      {
        task_id: "task-corrected",
        started_at: "2026-04-21T08:00:00.000Z",
        ended_at: "2026-04-21T09:28:00.000Z",
        duration_seconds: 1200,
        tasks: { title: "Corrected" },
      },
    ],
    {
      nowIso: "2026-04-21T12:00:00.000Z",
      todayWindow: {
        startIso: "2026-04-21T00:00:00.000Z",
        endIso: "2026-04-21T12:00:00.000Z",
      },
    },
  );

  assert.equal(aggregates.longestSessionSeconds, 5280);
  assert.equal(aggregates.longestSessionTaskTitle, "Corrected");
});

test("today bucket counts overlap within the local-day window after correction", () => {
  const aggregates = calculateTimerAggregates(
    [
      {
        task_id: "task-1",
        started_at: "2026-04-20T23:30:00.000Z",
        ended_at: "2026-04-21T01:00:00.000Z",
        duration_seconds: 1200,
        tasks: { title: "Cross-day" },
      },
    ],
    {
      nowIso: "2026-04-21T12:00:00.000Z",
      todayWindow: {
        startIso: "2026-04-21T00:00:00.000Z",
        endIso: "2026-04-21T12:00:00.000Z",
      },
    },
  );

  assert.equal(aggregates.todayTotalDurationSeconds, 3600);
  assert.equal(aggregates.sessionsTodayCount, 1);
});

test("aggregate helper uses corrected timestamps over stale duration field", () => {
  const aggregates = calculateTimerAggregates(
    [
      {
        task_id: "task-1",
        started_at: "2026-04-21T09:00:00.000Z",
        ended_at: "2026-04-21T10:28:00.000Z",
        duration_seconds: 1200,
        tasks: { title: "Fix timer" },
      },
    ],
    {
      nowIso: "2026-04-21T12:00:00.000Z",
      todayWindow: {
        startIso: "2026-04-21T00:00:00.000Z",
        endIso: "2026-04-21T12:00:00.000Z",
      },
    },
  );

  assert.equal(aggregates.trackedTotalSeconds, 5280);
  assert.equal(aggregates.todayTotalDurationSeconds, 5280);
});

test("aggregates keep corrected completed sessions fixed across later now values", () => {
  const completedSession = {
    task_id: "task-corrected",
    started_at: "2026-04-21T09:00:00.000Z",
    ended_at: "2026-04-21T10:28:00.000Z",
    duration_seconds: 1200,
    tasks: { title: "Corrected" },
  };

  const atNoon = calculateTimerAggregates([completedSession], {
    nowIso: "2026-04-21T12:00:00.000Z",
    todayWindow: {
      startIso: "2026-04-21T00:00:00.000Z",
      endIso: "2026-04-21T12:00:00.000Z",
    },
  });

  const laterNow = calculateTimerAggregates([completedSession], {
    nowIso: "2026-04-21T15:00:00.000Z",
    todayWindow: {
      startIso: "2026-04-21T00:00:00.000Z",
      endIso: "2026-04-21T15:00:00.000Z",
    },
  });

  assert.equal(atNoon.trackedTotalSeconds, 5280);
  assert.equal(laterNow.trackedTotalSeconds, 5280);
  assert.equal(atNoon.todayTotalDurationSeconds, 5280);
  assert.equal(laterNow.todayTotalDurationSeconds, 5280);
});

test("aggregates let active sessions grow across later now values", () => {
  const activeSession = {
    task_id: "task-active",
    started_at: "2026-04-21T09:00:00.000Z",
    ended_at: null,
    duration_seconds: null,
    tasks: { title: "Active" },
  };

  const atNoon = calculateTimerAggregates([activeSession], {
    nowIso: "2026-04-21T12:00:00.000Z",
    todayWindow: {
      startIso: "2026-04-21T00:00:00.000Z",
      endIso: "2026-04-21T12:00:00.000Z",
    },
  });

  const laterNow = calculateTimerAggregates([activeSession], {
    nowIso: "2026-04-21T12:15:00.000Z",
    todayWindow: {
      startIso: "2026-04-21T00:00:00.000Z",
      endIso: "2026-04-21T12:15:00.000Z",
    },
  });

  assert.equal(atNoon.trackedTotalSeconds, 10800);
  assert.equal(laterNow.trackedTotalSeconds, 11700);
  assert.equal(atNoon.todayTotalDurationSeconds, 10800);
  assert.equal(laterNow.todayTotalDurationSeconds, 11700);
});

type MockTimerSession = {
  id: string;
  task_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  updated_at?: string | null;
  tasks?: {
    title?: string | null;
    status?: string | null;
    priority?: string | null;
    goals?: { title: string | null } | null;
    projects?: { name: string | null; slug: string | null } | null;
  } | null;
};

function createTimerServiceSupabaseMock(sessions: MockTimerSession[]) {
  class SelectQuery {
    private filters = {
      endedAtIsNull: false,
      id: null as string | null,
    };

    constructor(private readonly columns: string) {}

    is(column: string, value: null) {
      assert.equal(column, "ended_at");
      assert.equal(value, null);
      this.filters.endedAtIsNull = true;
      return this;
    }

    eq(column: string, value: string) {
      assert.equal(column, "id");
      this.filters.id = value;
      return this;
    }

    order(column: string) {
      assert.equal(column, "started_at");
      return this;
    }

    limit() {
      return this;
    }

    maybeSingle() {
      return this.execute().then((result) => ({
        data: result.data[0] ?? null,
        error: result.error,
      }));
    }

    then<TResult1 = Awaited<{ data: unknown[]; error: null }>, TResult2 = never>(
      onfulfilled?:
        | ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return this.execute().then(onfulfilled, onrejected);
    }

    private async execute() {
      let data = [...sessions];

      if (this.filters.id) {
        data = data.filter((session) => session.id === this.filters.id);
      }

      if (this.filters.endedAtIsNull) {
        data = data.filter((session) => session.ended_at === null);
      }

      data.sort(
        (left, right) =>
          new Date(right.started_at).getTime() - new Date(left.started_at).getTime(),
      );

      return {
        data: data.map((session) => {
          if (this.columns.includes("tasks(")) {
            return session;
          }

          const record: Record<string, unknown> = {};
          for (const column of this.columns.split(",").map((value) => value.trim())) {
            record[column] = session[column as keyof MockTimerSession] ?? null;
          }
          return record;
        }),
        error: null,
      };
    }
  }

  return {
    supabase: {
      from(table: string) {
        assert.equal(table, "task_sessions");

        return {
          select(columns: string) {
            return new SelectQuery(columns);
          },
          update(payload: Record<string, unknown>) {
            const state = {
              id: null as string | null,
              requireOpen: false,
            };

            return {
              eq(column: string, value: string) {
                assert.equal(column, "id");
                state.id = value;
                return this;
              },
              is(column: string, value: null) {
                assert.equal(column, "ended_at");
                assert.equal(value, null);
                state.requireOpen = true;
                return this;
              },
              select(columns: string) {
                assert.equal(columns, "id");
                return {
                  maybeSingle: async () => {
                    const session = sessions.find((item) => item.id === state.id);
                    if (!session) {
                      return { data: null, error: null };
                    }
                    if (state.requireOpen && session.ended_at !== null) {
                      return { data: null, error: null };
                    }

                    session.ended_at = String(payload.ended_at ?? null);
                    session.duration_seconds = Number(payload.duration_seconds ?? 0);
                    session.updated_at = String(payload.updated_at ?? null);

                    return { data: { id: session.id }, error: null };
                  },
                };
              },
            };
          },
        };
      },
    } as never,
    sessions,
  };
}

test("stopTimerSession sets ended_at and finalizes duration_seconds", async () => {
  const mock = createTimerServiceSupabaseMock([
    {
      id: "session-open",
      task_id: "task-1",
      started_at: "2026-04-21T09:30:00.000Z",
      ended_at: null,
      duration_seconds: null,
    },
  ]);

  const result = await stopTimerSession({
    sessionId: "session-open",
    supabase: mock.supabase,
    nowIso: "2026-04-21T10:00:00.000Z",
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.stoppedTaskId, "task-1");
  assert.equal(mock.sessions[0]?.ended_at, "2026-04-21T10:00:00.000Z");
  assert.equal(mock.sessions[0]?.duration_seconds, 1800);
});

test("stopTimerSession does not return a follow-up task id when stop fails", async () => {
  const mock = createTimerServiceSupabaseMock([
    {
      id: "session-a",
      task_id: "task-1",
      started_at: "2026-04-21T09:30:00.000Z",
      ended_at: null,
      duration_seconds: null,
    },
    {
      id: "session-b",
      task_id: "task-2",
      started_at: "2026-04-21T09:35:00.000Z",
      ended_at: null,
      duration_seconds: null,
    },
  ]);

  const result = await stopTimerSession({
    supabase: mock.supabase,
    nowIso: "2026-04-21T10:00:00.000Z",
  });

  assert.equal(
    result.errorMessage,
    "Multiple open sessions detected. Resolve the conflict before stopping timers.",
  );
  assert.equal(result.stoppedTaskId, null);
});

test("stopped sessions remain fixed across later aggregate requests", async () => {
  const mock = createTimerServiceSupabaseMock([
    {
      id: "session-open",
      task_id: "task-1",
      started_at: "2026-04-21T09:30:00.000Z",
      ended_at: null,
      duration_seconds: null,
    },
  ]);

  await stopTimerSession({
    sessionId: "session-open",
    supabase: mock.supabase,
    nowIso: "2026-04-21T10:00:00.000Z",
  });

  const atStop = calculateTimerAggregates(mock.sessions, {
    nowIso: "2026-04-21T10:00:00.000Z",
    todayWindow: {
      startIso: "2026-04-21T00:00:00.000Z",
      endIso: "2026-04-21T10:00:00.000Z",
    },
  });

  const afterRefresh = calculateTimerAggregates(mock.sessions, {
    nowIso: "2026-04-21T12:00:00.000Z",
    todayWindow: {
      startIso: "2026-04-21T00:00:00.000Z",
      endIso: "2026-04-21T12:00:00.000Z",
    },
  });

  assert.equal(atStop.trackedTotalSeconds, 1800);
  assert.equal(afterRefresh.trackedTotalSeconds, 1800);
  assert.equal(atStop.todayTotalDurationSeconds, 1800);
  assert.equal(afterRefresh.todayTotalDurationSeconds, 1800);
});

test("active-session query returns none after stop", async () => {
  const mock = createTimerServiceSupabaseMock([
    {
      id: "session-open",
      task_id: "task-1",
      started_at: "2026-04-21T09:30:00.000Z",
      ended_at: null,
      duration_seconds: null,
      tasks: {
        title: "Fix timer",
        status: "in_progress",
        priority: "medium",
        goals: null,
        projects: { name: "Ops", slug: "ops" },
      },
    },
  ]);

  await stopTimerSession({
    sessionId: "session-open",
    supabase: mock.supabase,
    nowIso: "2026-04-21T10:00:00.000Z",
  });

  const activeSession = await getActiveTimerSession({
    supabase: mock.supabase,
    nowIso: "2026-04-21T10:05:00.000Z",
  });

  assert.equal(activeSession.errorMessage, null);
  assert.equal(activeSession.data, null);
});

test("later stop-style requests cannot extend an already stopped session", async () => {
  const mock = createTimerServiceSupabaseMock([
    {
      id: "session-open",
      task_id: "task-1",
      started_at: "2026-04-21T09:30:00.000Z",
      ended_at: null,
      duration_seconds: null,
    },
  ]);

  const firstStop = await stopTimerSession({
    sessionId: "session-open",
    supabase: mock.supabase,
    nowIso: "2026-04-21T10:00:00.000Z",
  });
  const secondStop = await stopTimerSession({
    sessionId: "session-open",
    supabase: mock.supabase,
    nowIso: "2026-04-21T10:15:00.000Z",
  });

  assert.equal(firstStop.errorMessage, null);
  assert.equal(secondStop.errorMessage, "No active timer session is available to stop.");
  assert.equal(mock.sessions[0]?.ended_at, "2026-04-21T10:00:00.000Z");
  assert.equal(mock.sessions[0]?.duration_seconds, 1800);
});
