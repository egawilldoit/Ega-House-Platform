import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseTimerSessionRepository, sanitizeSupabaseError } from "../src/index";

const ACTOR = createAuthenticatedActor("user-timer");

type QueryResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

class FakeTimerSupabase {
  constructor(private readonly results: QueryResult[]) {}

  from(table: string) {
    assert.equal(table, "task_sessions");
    return new FakeTimerQueryBuilder(this);
  }

  nextResult(): QueryResult {
    const result = this.results.shift();
    if (!result) throw new Error("No queued result configured for this query.");
    return result;
  }
}

class FakeTimerQueryBuilder {
  private readonly steps: string[] = [];

  constructor(private readonly supabase: FakeTimerSupabase) {}

  select(columns: string) {
    this.steps.push(`select:${columns}`);
    return this;
  }

  eq(column: string, value: unknown) {
    this.steps.push(`eq:${column}=${String(value)}`);
    return this;
  }

  is(column: string, value: null) {
    this.steps.push(`is:${column}=null`);
    assert.equal(value, null);
    return this;
  }

  order(column: string) {
    this.steps.push(`order:${column}`);
    return this;
  }

  limit(count: number) {
    this.steps.push(`limit:${count}`);
    return this;
  }

  insert(payload: unknown) {
    this.steps.push(`insert:${JSON.stringify(payload)}`);
    return this;
  }

  single() {
    this.steps.push("single");
    return Promise.resolve(this.supabase.nextResult());
  }

  then<TResult1, TResult2>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.supabase.nextResult()).then(onfulfilled, onrejected);
  }

  recordedSteps(): string[] {
    return [...this.steps];
  }
}

function timerRepository(fake: FakeTimerSupabase) {
  return new SupabaseTimerSessionRepository(fake as unknown as SupabaseClient);
}

test("sanitizeSupabaseError maps 23505 and the open-session index name to conflict", () => {
  assert.deepEqual(sanitizeSupabaseError({ code: "23505" }), { code: "conflict" });
  assert.deepEqual(
    sanitizeSupabaseError(
      { message: 'duplicate key value violates unique constraint "task_sessions_owner_open_unique"' },
      { conflictMessageHint: "task_sessions_owner_open_unique" },
    ),
    { code: "conflict" },
  );
});

test("insertOpenSession reports a typed conflict when the unique index rejects a concurrent start", async () => {
  const fake = new FakeTimerSupabase([
    {
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "task_sessions_owner_open_unique"',
      },
    },
  ]);

  const result = await timerRepository(fake).insertOpenSession(ACTOR, {
    taskId: "task-1",
    startedAtIso: "2026-08-22T10:00:00.000Z",
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.error, { code: "conflict" });
});

test("insertOpenSession keeps unknown failures untyped", async () => {
  const fake = new FakeTimerSupabase([
    { data: null, error: { code: "PGRST301", message: "JWT expired" } },
  ]);

  const result = await timerRepository(fake).insertOpenSession(ACTOR, {
    taskId: "task-1",
    startedAtIso: "2026-08-22T10:00:00.000Z",
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.error, { code: "unknown" });
});

test("listOpenSessions bounds the active-session read to the single-owner invariant", async () => {
  const fake = new FakeTimerSupabase([{ data: [], error: null }]);
  const builderCapture: FakeTimerQueryBuilder[] = [];
  const originalFrom = fake.from.bind(fake);
  fake.from = (table: string) => {
    const builder = originalFrom(table) as FakeTimerQueryBuilder;
    builderCapture.push(builder);
    return builder;
  };

  const result = await timerRepository(fake).listOpenSessions(ACTOR);

  assert.equal(result.ok, true);
  assert.deepEqual(builderCapture[0]?.recordedSteps(), [
    "select:id, task_id, started_at, ended_at, duration_seconds, tasks(title)",
    "eq:owner_user_id=user-timer",
    "is:ended_at=null",
    "order:started_at",
    "limit:1",
  ]);
});

test("insertOpenSession returns the mapped session row on success and scopes writes to the actor owner", async () => {
  const fake = new FakeTimerSupabase([
    {
      data: {
        id: "session-1",
        task_id: "task-1",
        started_at: "2026-08-22T10:00:00.000Z",
        ended_at: null,
        duration_seconds: null,
        tasks: { title: "Proof task" },
      },
      error: null,
    },
  ]);
  const builderCapture: FakeTimerQueryBuilder[] = [];
  const originalFrom = fake.from.bind(fake);
  fake.from = (table: string) => {
    const builder = originalFrom(table) as FakeTimerQueryBuilder;
    builderCapture.push(builder);
    return builder;
  };

  const result = await timerRepository(fake).insertOpenSession(ACTOR, {
    taskId: "task-1",
    startedAtIso: "2026-08-22T10:00:00.000Z",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.id, "session-1");
    assert.equal(result.value.taskTitle, "Proof task");
    assert.equal(result.value.endedAt, null);
  }
  assert.deepEqual(builderCapture[0]?.recordedSteps(), [
    'insert:{"owner_user_id":"user-timer","task_id":"task-1","started_at":"2026-08-22T10:00:00.000Z"}',
    "select:id, task_id, started_at, ended_at, duration_seconds, tasks(title)",
    "single",
  ]);
});
